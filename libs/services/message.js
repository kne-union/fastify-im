const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;
  const sequelize = fastify.sequelize.instance;

  function isUniqueError(error) {
    return error && (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === 'SQLITE_CONSTRAINT');
  }

  function unreadWhere(membership) {
    const lastReadSeq = Number(membership.lastReadSeq || 0);
    const lastReadId = membership.lastReadMessageId || '0';
    return {
      conversationId: membership.conversationId,
      status: 0,
      senderId: { [Op.ne]: membership.id },
      [Op.or]: [{ seq: { [Op.gt]: lastReadSeq } }, { seq: { [Op.is]: null }, id: { [Op.gt]: lastReadId } }]
    };
  }

  Object.assign(fastify[options.name].services, {
    message: {
      async sendMessage({ conversationId, senderMemberId, content, type = 'text', clientMsgId, traceId, onPersisted }) {
        const conv = await services.conversation.getConversationById(conversationId);
        if (!conv) throw new Error('Conversation not found');

        const senderMember = await models.conversationMember.findByPk(senderMemberId);
        if (!senderMember || senderMember.conversationId !== conversationId || senderMember.leftAt !== null) {
          throw new Error('Not a member of this conversation');
        }

        let message;
        let duplicated = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const saved = await sequelize.transaction(async transaction => {
              if (clientMsgId) {
                const existing = await models.message.findOne({
                  where: { conversationId, senderId: senderMemberId, clientMsgId },
                  transaction
                });
                if (existing) return { message: existing, duplicated: true };
              }
              const locked = await models.conversation.findByPk(conversationId, { transaction });
              if (!locked) throw new Error('Conversation not found');
              const seq = Number(locked.lastSeq || 0) + 1;
              await locked.update({ lastSeq: seq }, { transaction });
              const created = await models.message.create(
                {
                  conversationId,
                  senderId: senderMemberId,
                  senderRole: senderMember.role,
                  content,
                  type,
                  status: 0,
                  clientMsgId: clientMsgId || null,
                  seq,
                  traceId: traceId || null
                },
                { transaction }
              );
              return { message: created, duplicated: false };
            });
            message = saved.message;
            duplicated = saved.duplicated;
            break;
          } catch (error) {
            if (!isUniqueError(error) || attempt === 2) throw error;
            if (clientMsgId) {
              const existing = await models.message.findOne({
                where: { conversationId, senderId: senderMemberId, clientMsgId }
              });
              if (existing) {
                message = existing;
                duplicated = true;
                break;
              }
            }
          }
        }

        message.duplicated = duplicated;
        if (typeof onPersisted === 'function') await onPersisted(message);
        if (duplicated) {
          await services.metrics?.record('im:message:duplicate');
          return message;
        }
        await services.metrics?.record('im:message');

        const members = await services.conversation.getMemberIds(conversationId);
        const senderInfo = await services.conversation.getParticipantInfoByMemberId(senderMemberId);
        const messageData = { ...message.toJSON(), senderInfo };

        const senderClientId = services.conversation.getMemberClientId(senderMember);

        try {
          await Promise.all(
            members.map(async member => {
              const clientId = services.conversation.getMemberClientId(member);
              if (clientId === senderClientId) {
                await services.ws.sendToUser(clientId, 'sendMessageSuccess', { message: messageData });
              } else {
                const sent = await services.ws.sendToUser(clientId, 'newMessage', { message: messageData });
                if (!sent) {
                  const targetId = member.userId || member.id;
                  const targetType = member.userId ? 'user' : 'guest';
                  await services.notification.sendOfflineNotification({
                    targetId,
                    targetType,
                    messageInfo: messageData,
                    conversationInfo: conv.toJSON()
                  });
                }
              }
            })
          );

          const unreadCounts = await services.message.getUnreadCountByConversation(conversationId);
          await Promise.all(
            members.map(async member => {
              const clientId = services.conversation.getMemberClientId(member);
              if (clientId !== senderClientId) {
                await services.ws.sendToUser(clientId, 'unreadCountUpdated', {
                  conversationId,
                  unreadCount: unreadCounts[member.id] || 0
                });
              }
            })
          );
        } catch (error) {
          fastify.log?.error({ err: error, conversationId, clientMsgId: clientMsgId || null, traceId: traceId || null, seq: message.seq, instanceId: options.instanceId }, 'im broadcast failed');
        }

        return message;
      },

      async getMessageHistory(conversationId, memberId, beforeId = null, limit = 50) {
        const isMember = memberId ? await services.conversation.isMemberById(memberId, conversationId) : false;
        if (!isMember) throw new Error('Not a member of this conversation');

        const where = { conversationId, status: 0 };
        if (beforeId) {
          const cursor = await models.message.findByPk(beforeId);
          if (cursor && cursor.seq != null) {
            where[Op.or] = [{ seq: { [Op.lt]: cursor.seq } }, { seq: { [Op.is]: null } }];
          } else {
            where.id = { [Op.lt]: beforeId };
          }
        }

        const messages = await models.message.findAll({
          where,
          order: [
            [sequelize.literal('CASE WHEN seq IS NULL THEN 1 ELSE 0 END'), 'ASC'],
            ['seq', 'DESC'],
            ['createdAt', 'DESC']
          ],
          limit,
          include: [{ model: models.conversationMember, as: 'sender', required: false }]
        });

        return messages.reverse();
      },

      async readMessages(conversationId, memberId, lastMessageId, lastSeq) {
        const member = await models.conversationMember.findOne({
          where: { id: memberId, conversationId, leftAt: null }
        });
        if (!member) throw new Error('Not a member of this conversation');

        if (!lastMessageId && lastSeq != null) {
          const bySeq = await models.message.findOne({ where: { conversationId, seq: lastSeq } });
          if (!bySeq) throw new Error('Message not found');
          lastMessageId = bySeq.id;
        }
        const target = await models.message.findByPk(lastMessageId);
        if (!target || String(target.conversationId) !== String(conversationId)) {
          throw new Error('Message not in this conversation');
        }
        const currentSeq = Number(member.lastReadSeq || 0);
        if (target.seq != null && target.seq < currentSeq) {
          return { success: true, advanced: false };
        }
        await member.update({
          lastReadMessageId: lastMessageId,
          lastReadSeq: target.seq == null ? currentSeq : Math.max(currentSeq, target.seq)
        });

        const clientId = services.conversation.getMemberClientId(member);
        await services.conversation.broadcastToConversation(
          conversationId,
          'messageRead',
          {
            conversationId,
            memberId,
            lastMessageId
          },
          { excludeClientId: clientId }
        );

        return { success: true, advanced: true };
      },

      async recvAck({ messageId, memberId }) {
        const message = await models.message.findByPk(messageId);
        if (!message) throw new Error('Message not found');
        const member = await models.conversationMember.findOne({
          where: { id: memberId, conversationId: message.conversationId, leftAt: null }
        });
        if (!member) throw new Error('Not a member of this conversation');
        await models.messageReceipt.findOrCreate({
          where: { messageId, memberId },
          defaults: { recvAckAt: new Date() }
        });
        await services.metrics?.record('im:recv_ack');
        return { success: true };
      },

      async revokeMessage(messageId, { memberId, userId } = {}) {
        const message = await models.message.findByPk(messageId);
        if (!message) throw new Error('Message not found');
        if (message.status === 1) throw new Error('Message already revoked');

        // 通过memberId直接比较，或通过userId查找memberId
        let resolvedMemberId = memberId;
        if (!resolvedMemberId && userId) {
          const member = await models.conversationMember.findOne({
            where: { conversationId: message.conversationId, userId, leftAt: null }
          });
          resolvedMemberId = member?.id;
        }

        if (!resolvedMemberId || message.senderId !== resolvedMemberId) {
          throw new Error('Can only revoke own messages');
        }

        await message.update({ status: 1 });

        await services.conversation.broadcastToConversation(message.conversationId, 'messageRevoked', {
          messageId,
          conversationId: message.conversationId
        });

        return { success: true };
      },

      async getUnreadCount(userId) {
        const memberships = await models.conversationMember.findAll({
          where: { userId, leftAt: null }
        });

        let total = 0;
        for (const membership of memberships) {
          const count = await models.message.count({ where: unreadWhere(membership) });
          total += count;
        }

        return total;
      },

      async getUnreadCountByConversation(conversationId) {
        const memberships = await models.conversationMember.findAll({
          where: { conversationId, leftAt: null }
        });

        const result = {};
        for (const membership of memberships) {
          result[membership.id] = await models.message.count({ where: unreadWhere(membership) });
        }

        return result;
      },

      async getUnreadCountByConversations(userId) {
        const memberships = await models.conversationMember.findAll({
          where: { userId, leftAt: null }
        });

        const result = {};
        for (const membership of memberships) {
          result[membership.conversationId] = await models.message.count({ where: unreadWhere(membership) });
        }

        return result;
      }
    }
  });
});

const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  Object.assign(fastify[options.name].services, {
    message: {
      async sendMessage({ conversationId, senderMemberId, content, type = 'text' }) {
        const conv = await services.conversation.getConversationById(conversationId);
        if (!conv) throw new Error('Conversation not found');

        const senderMember = await models.conversationMember.findByPk(senderMemberId);
        if (!senderMember || senderMember.conversationId !== conversationId || senderMember.leftAt !== null) {
          throw new Error('Not a member of this conversation');
        }

        const message = await models.message.create({
          conversationId,
          senderId: senderMemberId,
          senderRole: senderMember.role,
          content,
          type,
          status: 0
        });

        const members = await services.conversation.getMemberIds(conversationId);
        const senderInfo = await services.conversation.getParticipantInfoByMemberId(senderMemberId);
        const messageData = { ...message.toJSON(), senderInfo };

        const senderClientId = services.conversation.getMemberClientId(senderMember);

        // 并行广播消息
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

        // 并行推送未读计数
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

        return message;
      },

      async getMessageHistory(conversationId, memberId, beforeId = null, limit = 50) {
        const isMember = memberId ? await services.conversation.isMemberById(memberId, conversationId) : false;
        if (!isMember) throw new Error('Not a member of this conversation');

        const where = { conversationId, status: 0 };
        if (beforeId) {
          where.id = { [Op.lt]: beforeId };
        }

        const messages = await models.message.findAll({
          where,
          order: [['createdAt', 'DESC']],
          limit,
          include: [{ model: models.conversationMember, as: 'sender', required: false }]
        });

        return messages.reverse();
      },

      async readMessages(conversationId, memberId, lastMessageId) {
        const member = await models.conversationMember.findOne({
          where: { id: memberId, conversationId, leftAt: null }
        });
        if (!member) throw new Error('Not a member of this conversation');

        await member.update({ lastReadMessageId: lastMessageId });

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
          const lastReadId = membership.lastReadMessageId || '0';
          const count = await models.message.count({
            where: {
              conversationId: membership.conversationId,
              status: 0,
              id: { [Op.gt]: lastReadId },
              senderId: { [Op.ne]: membership.id }
            }
          });
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
          const lastReadId = membership.lastReadMessageId || '0';
          result[membership.id] = await models.message.count({
            where: {
              conversationId,
              status: 0,
              id: { [Op.gt]: lastReadId },
              senderId: { [Op.ne]: membership.id }
            }
          });
        }

        return result;
      },

      async getUnreadCountByConversations(userId) {
        const memberships = await models.conversationMember.findAll({
          where: { userId, leftAt: null }
        });

        const result = {};
        for (const membership of memberships) {
          const lastReadId = membership.lastReadMessageId || '0';
          result[membership.conversationId] = await models.message.count({
            where: {
              conversationId: membership.conversationId,
              status: 0,
              id: { [Op.gt]: lastReadId },
              senderId: { [Op.ne]: membership.id }
            }
          });
        }

        return result;
      }
    }
  });
});

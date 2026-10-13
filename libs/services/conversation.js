const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  function getMemberClientId(member) {
    return member.userId || `guest_${member.id}`;
  }

  Object.assign(fastify[options.name].services, {
    conversation: {
      getMemberClientId,

      async createSingleConversation(userId1, userId2) {
        const convs1 = await models.conversationMember.findAll({
          where: { userId: userId1 },
          attributes: ['conversationId']
        });
        const convIds1 = convs1.map(m => m.conversationId);

        if (convIds1.length > 0) {
          const existing = await models.conversation.findOne({
            where: { id: { [Op.in]: convIds1 }, type: 'single' },
            include: [
              {
                model: models.conversationMember,
                where: { userId: userId2 }
              }
            ]
          });

          if (existing) {
            // 重新激活已退出的成员
            await models.conversationMember.update({ leftAt: null }, { where: { conversationId: existing.id, leftAt: { [Op.ne]: null } } });
            return existing;
          }
        }

        const conversation = await models.conversation.create({
          type: 'single',
          createdBy: userId1
        });

        await models.conversationMember.bulkCreate([
          { conversationId: conversation.id, userId: userId1, role: 'member' },
          { conversationId: conversation.id, userId: userId2, role: 'member' }
        ]);

        return conversation;
      },

      async createGroupConversation({ name, avatar, creatorId, memberIds = [] }) {
        const conversation = await models.conversation.create({
          type: 'group',
          name,
          avatar,
          createdBy: creatorId
        });

        const uniqueMemberIds = [...new Set(memberIds)];
        const members = [
          { conversationId: conversation.id, userId: creatorId, role: 'owner' },
          ...uniqueMemberIds
            .filter(id => id !== creatorId)
            .map(userId => ({
              conversationId: conversation.id,
              userId,
              role: 'member'
            }))
        ];

        await models.conversationMember.bulkCreate(members);
        return conversation;
      },

      async createGuestConversation({ recipientUserId, nickname, avatar }) {
        const conversation = await models.conversation.create({
          type: 'single',
          createdBy: recipientUserId
        });

        await models.conversationMember.create({
          conversationId: conversation.id,
          userId: recipientUserId,
          role: 'member'
        });

        const guestMember = await models.conversationMember.create({
          conversationId: conversation.id,
          userId: null,
          role: 'guest',
          nickname,
          avatar
        });

        return { conversation, guestMember };
      },

      async findOrCreateGuestConversation({ recipientUserId, nickname, avatar }) {
        // 查找已有访客会话: 同一接收人+同昵称的访客
        const existingGuest = await models.conversationMember.findOne({
          where: { userId: null, role: 'guest', nickname, leftAt: null },
          include: [
            {
              model: models.conversation,
              as: 'conversation',
              where: { type: 'single', createdBy: recipientUserId },
              include: [
                {
                  model: models.conversationMember,
                  as: 'members',
                  where: { userId: recipientUserId, leftAt: null }
                }
              ]
            }
          ]
        });

        if (existingGuest) {
          const conversation = await models.conversation.findByPk(existingGuest.conversationId);
          if (conversation) {
            return { conversation, guestMember: existingGuest };
          }
        }

        return this.createGuestConversation({ recipientUserId, nickname, avatar });
      },

      async getConversations(userId, page = 1, pageSize = 20) {
        const offset = (page - 1) * pageSize;

        const memberships = await models.conversationMember.findAll({
          where: { userId, leftAt: null },
          attributes: ['id', 'conversationId', 'lastReadMessageId']
        });

        if (memberships.length === 0) return [];

        const lastReadMap = {};
        const memberIdMap = {};
        memberships.forEach(m => {
          lastReadMap[m.conversationId] = m.lastReadMessageId;
          memberIdMap[m.conversationId] = m.id;
        });

        const convIds = memberships.map(m => m.conversationId);

        const conversations = await models.conversation.findAll({
          where: { id: { [Op.in]: convIds } },
          include: [
            { model: models.conversationMember, where: { leftAt: null }, as: 'members', required: false },
            { model: models.message, as: 'messages', limit: 1, order: [['createdAt', 'DESC']], required: false }
          ],
          limit: pageSize,
          offset
        });

        // 按最新消息时间在内存中排序（避免 SQLite 下关联排序的兼容性问题）
        conversations.sort((a, b) => {
          const aTime = a.messages && a.messages[0] ? new Date(a.messages[0].createdAt).getTime() : 0;
          const bTime = b.messages && b.messages[0] ? new Date(b.messages[0].createdAt).getTime() : 0;
          return bTime - aTime;
        });

        const result = [];
        for (const conv of conversations) {
          const lastReadId = lastReadMap[conv.id] || '0';
          const memberId = memberIdMap[conv.id];
          // senderId是conversationMember.id，排除自己发送的消息
          const unreadCount = await models.message.count({
            where: {
              conversationId: conv.id,
              status: 0,
              id: { [Op.gt]: lastReadId },
              senderId: { [Op.ne]: memberId }
            }
          });

          result.push({
            ...conv.toJSON(),
            unreadCount,
            lastMessage: (conv.messages && conv.messages[0]) || null,
            lastReadMessageId: lastReadMap[conv.id] || null
          });
        }

        return result;
      },

      async getConversationDetail(conversationId, memberId) {
        const conv = await models.conversation.findByPk(conversationId, {
          include: [
            { model: models.conversationMember, where: { leftAt: null }, as: 'members', required: false },
            { model: models.message, as: 'messages', limit: 1, order: [['createdAt', 'DESC']], required: false }
          ]
        });

        if (!conv) return null;

        const member = memberId ? await models.conversationMember.findByPk(memberId) : null;
        const lastReadId = member?.lastReadMessageId || '0';
        const unreadCount = await models.message.count({
          where: {
            conversationId,
            status: 0,
            id: { [Op.gt]: lastReadId },
            senderId: { [Op.ne]: memberId }
          }
        });

        return {
          ...conv.toJSON(),
          unreadCount,
          lastMessage: (conv.messages && conv.messages[0]) || null,
          lastReadMessageId: lastReadId || null
        };
      },

      async getConversationIdsByUser(userId) {
        const memberships = await models.conversationMember.findAll({
          where: { userId, leftAt: null },
          attributes: ['conversationId']
        });
        return memberships.map(m => m.conversationId);
      },

      async addMember(conversationId, userId, role = 'member', { nickname, avatar } = {}) {
        const where = { conversationId, leftAt: null };
        if (userId) {
          where.userId = userId;
        } else {
          where.role = 'guest';
          where.nickname = nickname;
        }

        const existing = await models.conversationMember.findOne({ where });
        if (existing) return existing;

        const leftWhere = { conversationId, leftAt: { [Op.ne]: null } };
        if (userId) {
          leftWhere.userId = userId;
        } else {
          leftWhere.role = 'guest';
          leftWhere.nickname = nickname;
        }

        const left = await models.conversationMember.findOne({ where: leftWhere });
        if (left) {
          await left.update({ leftAt: null, role, nickname: nickname || left.nickname, avatar: avatar || left.avatar });
          return left;
        }

        return models.conversationMember.create({ conversationId, userId, role, nickname, avatar });
      },

      async removeMember(conversationId, userId) {
        return models.conversationMember.update({ leftAt: new Date() }, { where: { conversationId, userId, leftAt: null } });
      },

      async leaveConversation(conversationId, userId) {
        return models.conversationMember.update({ leftAt: new Date() }, { where: { conversationId, userId, leftAt: null } });
      },

      async getMembers(conversationId) {
        const members = await models.conversationMember.findAll({
          where: { conversationId, leftAt: null },
          include: [{ model: options.getUserModel(), as: 'user', required: false }]
        });
        return members.map(member => {
          const json = member.toJSON();
          if (member.user) {
            json.name = member.user.name || member.user.nickname || member.user.username;
            json.avatar = member.user.avatar;
            json.isGuest = false;
          } else {
            json.name = member.nickname;
            json.avatar = member.avatar;
            json.isGuest = member.role === 'guest';
          }
          json.clientId = getMemberClientId(member);
          return json;
        });
      },

      async getMemberIds(conversationId) {
        const members = await models.conversationMember.findAll({
          where: { conversationId, leftAt: null },
          attributes: ['id', 'userId', 'role', 'nickname', 'avatar']
        });
        return members;
      },

      async isMember(conversationId, userId) {
        const member = await models.conversationMember.findOne({
          where: { conversationId, userId, leftAt: null }
        });
        return !!member;
      },

      async isMemberById(memberId, conversationId) {
        const member = await models.conversationMember.findOne({
          where: { id: memberId, conversationId, leftAt: null }
        });
        return !!member;
      },

      async getMemberById(memberId) {
        return models.conversationMember.findByPk(memberId);
      },

      async getMemberByUserAndConversation(userId, conversationId) {
        return models.conversationMember.findOne({
          where: { conversationId, userId, leftAt: null }
        });
      },

      async resolveMemberId(clientInfo, conversationId) {
        if (clientInfo.memberId) return clientInfo.memberId;
        if (clientInfo.isGuest) return null;
        const member = await this.getMemberByUserAndConversation(clientInfo.userId, conversationId);
        return member?.id || null;
      },

      async getConversationById(conversationId) {
        return models.conversation.findByPk(conversationId);
      },

      async updateConversation(conversationId, data) {
        return models.conversation.update(data, { where: { id: conversationId } });
      },

      async getParticipantInfo(userId, conversationId) {
        if (conversationId) {
          const member = await models.conversationMember.findOne({
            where: { conversationId, userId, leftAt: null },
            include: [{ model: options.getUserModel(), as: 'user', required: false }]
          });
          if (member) {
            if (member.user) {
              return {
                name: member.user.name || member.user.nickname || member.user.username,
                avatar: member.user.avatar,
                isGuest: false
              };
            }
            if (member.nickname) {
              return { name: member.nickname, avatar: member.avatar, isGuest: member.role === 'guest' };
            }
          }
        }
        if (options.getParticipantInfo) {
          return options.getParticipantInfo(userId);
        }
        try {
          const UserModel = options.getUserModel();
          const user = await UserModel.findByPk(userId);
          if (user) {
            return { name: user.name || user.nickname || user.username, avatar: user.avatar, isGuest: false };
          }
        } catch (e) {}
        return { name: userId, avatar: null, isGuest: false };
      },

      async getParticipantInfoByMemberId(memberId) {
        const member = await models.conversationMember.findByPk(memberId, {
          include: [{ model: options.getUserModel(), as: 'user', required: false }]
        });
        if (!member) return { name: 'unknown', avatar: null, isGuest: false };
        if (member.user) {
          return {
            name: member.user.name || member.user.nickname || member.user.username,
            avatar: member.user.avatar,
            isGuest: false
          };
        }
        return { name: member.nickname, avatar: member.avatar, isGuest: member.role === 'guest' };
      },

      async broadcastToConversation(conversationId, type, payload, { excludeClientId } = {}) {
        const members = await models.conversationMember.findAll({
          where: { conversationId, leftAt: null }
        });
        await Promise.all(
          members.map(member => {
            const clientId = getMemberClientId(member);
            if (clientId === excludeClientId) return;
            return services.ws.sendToUser(clientId, type, payload);
          })
        );
      }
    }
  });
});

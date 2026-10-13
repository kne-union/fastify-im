const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/conversations`,
    {
      onRequest: options.getAuthenticate('conversation'),
      schema: {
        description: '获取当前用户的会话列表',
        summary: '获取会话列表',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            pageSize: { type: 'number', default: 20 }
          }
        }
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const { page = 1, pageSize = 20 } = request.query;
      const list = await services.conversation.getConversations(userId, page, pageSize);
      return { list };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/single`,
    {
      onRequest: options.getAuthenticate('conversation:create'),
      schema: {
        description: '创建单聊会话(已存在则返回已有)',
        summary: '创建单聊',
        body: {
          type: 'object',
          required: ['targetUserId'],
          properties: {
            targetUserId: { type: 'string', description: '对方用户ID' }
          }
        }
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const { targetUserId } = request.body;
      const conversation = await services.conversation.createSingleConversation(userId, targetUserId);

      await services.conversation.broadcastToConversation(conversation.id, 'conversationUpdated', {
        conversationId: conversation.id,
        action: 'created'
      });

      return { conversation };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/group`,
    {
      onRequest: options.getAuthenticate('conversation:create'),
      schema: {
        description: '创建群聊',
        summary: '创建群聊',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: '群名称' },
            avatar: { type: 'string', description: '群头像' },
            memberIds: { type: 'array', items: { type: 'string' }, description: '初始成员ID列表' }
          }
        }
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const { name, avatar, memberIds } = request.body;
      const conversation = await services.conversation.createGroupConversation({
        name,
        avatar,
        creatorId: userId,
        memberIds
      });

      await services.conversation.broadcastToConversation(conversation.id, 'conversationUpdated', {
        conversationId: conversation.id,
        action: 'created'
      });

      return { conversation };
    }
  );

  fastify.get(
    `${options.prefix}/conversations/:id/members`,
    {
      onRequest: options.getAuthenticate('conversation'),
      schema: {
        description: '获取会话成员列表',
        summary: '获取成员列表'
      }
    },
    async request => {
      const { id } = request.params;
      const members = await services.conversation.getMembers(id);
      return { members };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/:id/members`,
    {
      onRequest: options.getAuthenticate('conversation:manage'),
      schema: {
        description: '添加群成员',
        summary: '添加成员',
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' },
            role: { type: 'string', default: 'member' },
            nickname: { type: 'string', description: '参与者昵称(访客必填)' },
            avatar: { type: 'string', description: '参与者头像(访客必填)' }
          }
        }
      }
    },
    async request => {
      const { id } = request.params;
      const { userId, role, nickname, avatar } = request.body;
      const member = await services.conversation.addMember(id, userId, role, { nickname, avatar });
      const clientId = services.conversation.getMemberClientId(member);
      await services.ws.sendToUser(clientId, 'conversationUpdated', { conversationId: id, action: 'added' });
      return { member };
    }
  );

  fastify.delete(
    `${options.prefix}/conversations/:id/members/:userId`,
    {
      onRequest: options.getAuthenticate('conversation:manage'),
      schema: {
        description: '移除群成员',
        summary: '移除成员'
      }
    },
    async request => {
      const { id, userId } = request.params;
      await services.conversation.removeMember(id, userId);
      await services.ws.sendToUser(userId, 'conversationUpdated', { conversationId: id, action: 'removed' });
      return { success: true };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/:id/leave`,
    {
      onRequest: options.getAuthenticate('conversation:leave'),
      schema: {
        description: '退出群聊',
        summary: '退出群聊'
      }
    },
    async request => {
      const { id } = request.params;
      const userId = request.userInfo?.userId;
      await services.conversation.leaveConversation(id, userId);
      await services.ws.sendToUser(userId, 'conversationUpdated', { conversationId: id, action: 'left' });
      return { success: true };
    }
  );

  fastify.put(
    `${options.prefix}/conversations/:id`,
    {
      onRequest: options.getAuthenticate('conversation:manage'),
      schema: {
        description: '更新会话信息(群名称/头像)',
        summary: '更新会话',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            avatar: { type: 'string' }
          }
        }
      }
    },
    async request => {
      const { id } = request.params;
      const { name, avatar } = request.body;
      await services.conversation.updateConversation(id, { name, avatar });

      await services.conversation.broadcastToConversation(id, 'conversationUpdated', {
        conversationId: id,
        action: 'updated'
      });

      return { success: true };
    }
  );
});

const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/conversations/:id/messages`,
    {
      onRequest: options.getAuthenticate('message'),
      schema: {
        description: '获取会话消息历史(分页)',
        summary: '获取消息历史',
        querystring: {
          type: 'object',
          properties: {
            beforeId: { type: 'string', description: '加载此ID之前的消息' },
            limit: { type: 'number', default: 50 }
          }
        }
      }
    },
    async request => {
      const { id } = request.params;
      const userId = request.userInfo?.userId;
      const { beforeId, limit = 50 } = request.query;

      const member = await services.conversation.getMemberByUserAndConversation(userId, id);
      if (!member) throw new Error('Not a member of this conversation');

      const list = await services.message.getMessageHistory(id, member.id, beforeId, limit);
      return { list };
    }
  );

  fastify.get(
    `${options.prefix}/unread-count`,
    {
      onRequest: options.getAuthenticate('message'),
      schema: {
        description: '获取未读消息计数',
        summary: '获取未读计数'
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const conversations = await services.message.getUnreadCountByConversations(userId);
      const system = await services.systemMessage.getUnreadSystemMessageCount(userId);
      const total = Object.values(conversations).reduce((sum, count) => sum + count, 0);
      return { total, conversations, system };
    }
  );
});

const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/system-messages`,
    {
      onRequest: options.getAuthenticate('systemMessage'),
      schema: {
        description: '获取系统消息列表',
        summary: '获取系统消息',
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
      const result = await services.systemMessage.getSystemMessages(userId, page, pageSize);
      return result;
    }
  );

  fastify.post(
    `${options.prefix}/system-messages/:id/read`,
    {
      onRequest: options.getAuthenticate('systemMessage'),
      schema: {
        description: '标记系统消息已读',
        summary: '标记已读'
      }
    },
    async request => {
      const { id } = request.params;
      const userId = request.userInfo?.userId;
      await services.systemMessage.readSystemMessage(id, userId);
      return { success: true };
    }
  );

  fastify.post(
    `${options.prefix}/system-messages/read-all`,
    {
      onRequest: options.getAuthenticate('systemMessage'),
      schema: {
        description: '标记所有系统消息已读',
        summary: '全部已读'
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      await services.systemMessage.readAllSystemMessages(userId);
      return { success: true };
    }
  );
});

const fp = require('fastify-plugin');
const { num, list, obj, success, ok, systemMessage } = require('../schema/response');

const TAG = 'IM-系统消息';

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/system-messages`,
    {
      onRequest: options.getAuthenticate('systemMessage'),
      schema: {
        tags: [TAG],
        description: '分页获取发给当前用户的系统消息，按创建时间倒序',
        summary: '获取系统消息',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1, description: '页码' },
            pageSize: { type: 'number', default: 20, description: '每页数量' }
          }
        },
        response: success(
          '系统消息分页列表',
          obj('系统消息分页列表', {
            total: num('系统消息总数'),
            list: list('当前页系统消息', systemMessage),
            page: num('页码'),
            pageSize: num('每页数量')
          })
        )
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
        tags: [TAG],
        description: '把当前用户的一条系统消息标记为已读；消息不存在或不属于当前用户时也返回成功',
        summary: '标记已读',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '系统消息 ID' }
          }
        },
        response: ok('标记成功')
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
        tags: [TAG],
        description: '把当前用户所有未读系统消息标记为已读',
        summary: '全部已读',
        response: ok('标记成功')
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      await services.systemMessage.readAllSystemMessages(userId);
      return { success: true };
    }
  );
});

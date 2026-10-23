const fp = require('fastify-plugin');
const { num, list, obj, success, member, message } = require('../schema/response');

const TAG = 'IM-消息';

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/conversations/:id/messages`,
    {
      onRequest: options.getAuthenticate('message'),
      schema: {
        tags: [TAG],
        description: '分页获取会话内未撤回的消息，按序号从旧到新返回；当前用户不是会话成员时报错',
        summary: '获取消息历史',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '会话 ID' }
          }
        },
        querystring: {
          type: 'object',
          properties: {
            beforeId: { type: 'string', description: '加载此ID之前的消息' },
            limit: { type: 'number', default: 50, description: '返回条数' }
          }
        },
        response: success(
          '消息列表',
          obj('消息列表', {
            list: list('消息列表，按序号从旧到新', message('消息', { sender: member('发送者的会话成员记录') }))
          })
        )
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
        tags: [TAG],
        description: '获取当前用户的未读消息计数：各会话未读数和未读系统消息数',
        summary: '获取未读计数',
        response: success(
          '未读计数',
          obj('未读计数', {
            total: num('各会话未读消息数之和（不含系统消息）'),
            conversations: obj('各会话未读消息数，键为会话 ID'),
            system: num('未读系统消息数')
          })
        )
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

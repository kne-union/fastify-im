const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/welcome`,
    {
      schema: {
        description: 'IM服务欢迎接口',
        summary: '欢迎接口'
      }
    },
    async request => {
      return { message: 'welcome to fastify-im' };
    }
  );

  fastify.get(
    `${options.prefix}/status`,
    {
      schema: {
        description: 'IM服务状态',
        summary: '服务状态'
      }
    },
    async request => {
      const onlineCount = services.ws ? await services.ws.getOnlineCount() : 0;
      return { status: 'ok', onlineCount };
    }
  );
});

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
      return { status: 'ok', onlineCount, instanceId: options.instanceId };
    }
  );

  fastify.get(
    `${options.prefix}/metrics`,
    {
      schema: {
        description: '当前进程的 IM 指标',
        summary: '进程指标'
      }
    },
    async (request, reply) => {
      const { models } = fastify[options.name];
      const { Op } = fastify.sequelize.Sequelize;
      const online = services.ws ? await services.ws.getOnlineCount() : 0;
      const offline = models.notification ? await models.notification.count() : 0;
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = models.message ? await models.message.count({ where: { createdAt: { [Op.gte]: since }, seq: { [Op.ne]: null } } }) : 0;
      const acked = models.messageReceipt ? await models.messageReceipt.count({ where: { createdAt: { [Op.gte]: since } } }) : 0;
      const unacked = Math.max(0, recent - acked);
      const warnAt = options.backlogWarn || 1000;
      if (offline >= warnAt || unacked >= warnAt) {
        fastify.log.warn({ offline, unacked, instanceId: options.instanceId }, 'im backlog high');
      }
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return services.metrics.render({
        im_online_connections: online,
        im_offline_backlog: offline,
        im_unacked_messages: unacked
      });
    }
  );
});

const fp = require('fastify-plugin');
const { str, any, obj, success } = require('../schema/response');

const TAG = 'IM-服务';

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/welcome`,
    {
      schema: {
        tags: [TAG],
        description: 'IM服务欢迎接口，无需登录',
        summary: '欢迎接口',
        response: success('欢迎信息', obj('欢迎信息', { message: str('固定为 welcome to fastify-im') }))
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
        tags: [TAG],
        description: 'IM服务状态，无需登录',
        summary: '服务状态',
        response: success(
          '服务状态',
          obj('服务状态', {
            status: str('固定为 ok'),
            onlineCount: any('当前在线连接数（来自连接存储）'),
            instanceId: any('当前进程实例 ID')
          })
        )
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
        tags: [TAG],
        description: '当前进程的 IM 指标，Prometheus 文本格式（text/plain; version=0.0.4），无需登录。包含在线连接数、离线通知积压、近一小时未确认消息数等；积压超过 backlogWarn 时记录告警日志',
        summary: '进程指标',
        response: {
          200: { description: 'Prometheus 文本格式的指标（非 JSON）' }
        }
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

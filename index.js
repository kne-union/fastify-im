const fp = require('fastify-plugin');
const path = require('node:path');

module.exports = fp(async (fastify, options) => {
  options = Object.assign(
    {},
    {
      dbTableNamePrefix: 't_',
      name: 'im',
      offlineNotifyInterval: 24,
      heartbeatInterval: 30000,
      connectionStore: null,
      sendOfflineMessages: null,
      getParticipantInfo: null,
      getUserModel: () => {
        if (!fastify.account) {
          throw new Error('fastify-account 插件未注册，无法获取用户模型，请注册fastify-account插件或者自行实现options.getUserModel');
        }
        return fastify.account.models.user;
      },
      getAuthenticate: type => {
        if (!fastify.account) {
          return [];
        }
        const { authenticate } = fastify.account;
        switch (type) {
          case 'conversation':
          case 'conversation:create':
          case 'conversation:leave':
          case 'message':
          case 'conversation:manage':
          case 'systemMessage':
          default:
            return [authenticate.user];
        }
      }
    },
    options
  );

  fastify.register(require('@kne/fastify-namespace'), {
    options,
    name: options.name,
    modules: [
      ['controllers', path.resolve(__dirname, './libs/controllers')],
      [
        'models',
        await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
          prefix: options.dbTableNamePrefix,
          getUserModel: options.getUserModel,
          modelPrefix: options.name
        })
      ],
      ['services', path.resolve(__dirname, './libs/services')]
    ]
  });
});

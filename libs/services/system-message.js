const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  Object.assign(fastify[options.name].services, {
    systemMessage: {
      async pushSystemMessage({ type, title, content, targetUserId, targetRole, props }) {
        if (targetUserId) {
          const message = await models.systemMessage.create({
            type,
            title,
            content,
            targetUserId,
            targetRole: targetRole || null,
            props,
            isRead: false
          });
          await services.ws.sendToUser(targetUserId, 'systemMessage', { message: message.toJSON() });
          return [message];
        }

        if (targetRole) {
          const onlineUserIds = await services.ws.getOnlineUserIds();
          const messages = [];
          for (const userId of onlineUserIds) {
            const connections = await services.ws.getUserConnections(userId);
            const hasRole = connections.some(c => c.role === targetRole);
            if (hasRole) {
              const message = await models.systemMessage.create({
                type,
                title,
                content,
                targetUserId: userId,
                targetRole,
                props,
                isRead: false
              });
              await services.ws.sendToUser(userId, 'systemMessage', { message: message.toJSON() });
              messages.push(message);
            }
          }
          return messages;
        }

        const onlineUserIds = await services.ws.getOnlineUserIds();
        const messages = [];
        for (const userId of onlineUserIds) {
          const message = await models.systemMessage.create({
            type,
            title,
            content,
            targetUserId: userId,
            props,
            isRead: false
          });
          await services.ws.sendToUser(userId, 'systemMessage', { message: message.toJSON() });
          messages.push(message);
        }
        return messages;
      },

      async getSystemMessages(userId, page = 1, pageSize = 20) {
        const offset = (page - 1) * pageSize;
        const { count, rows } = await models.systemMessage.findAndCountAll({
          where: { targetUserId: userId },
          order: [['createdAt', 'DESC']],
          limit: pageSize,
          offset
        });
        return { total: count, list: rows, page, pageSize };
      },

      async readSystemMessage(messageId, userId) {
        return models.systemMessage.update({ isRead: true }, { where: { id: messageId, targetUserId: userId } });
      },

      async readAllSystemMessages(userId) {
        return models.systemMessage.update({ isRead: true }, { where: { targetUserId: userId, isRead: false } });
      },

      async getUnreadSystemMessageCount(userId) {
        return models.systemMessage.count({
          where: { targetUserId: userId, isRead: false }
        });
      }
    }
  });
});

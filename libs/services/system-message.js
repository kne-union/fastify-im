const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];

  Object.assign(fastify[options.name].services, {
    systemMessage: {
      async persistForUser(userId, fields) {
        if (fields.dedupeKey) {
          const existing = await models.systemMessage.findOne({
            where: { targetUserId: userId, dedupeKey: fields.dedupeKey }
          });
          if (existing) return existing;
        }
        try {
          const message = await models.systemMessage.create({
            ...fields,
            targetUserId: userId,
            isRead: false
          });
          await services.ws.sendToUser(userId, 'systemMessage', { message: message.toJSON() });
          return message;
        } catch (error) {
          if (error?.name === 'SequelizeUniqueConstraintError' && fields.dedupeKey) {
            return models.systemMessage.findOne({ where: { targetUserId: userId, dedupeKey: fields.dedupeKey } });
          }
          throw error;
        }
      },

      async pushSystemMessage({ type, title, content, targetUserId, targetRole, props, dedupeKey }) {
        const fields = { type, title, content, targetRole: targetRole || null, props, dedupeKey: dedupeKey || null };
        if (targetUserId) {
          return [await services.systemMessage.persistForUser(targetUserId, fields)];
        }

        let userIds = [];
        if (targetRole && typeof options.listUserIdsByRole === 'function') {
          userIds = await options.listUserIdsByRole(targetRole);
        } else if (!targetRole && typeof options.listUserIds === 'function') {
          userIds = await options.listUserIds();
        } else {
          fastify.log?.warn({ targetRole: targetRole || null }, 'system message fan-out has no user directory, using online users on this instance');
          const onlineUserIds = await services.ws.getOnlineUserIds();
          if (targetRole) {
            for (const userId of onlineUserIds) {
              const connections = await services.ws.getUserConnections(userId);
              if (connections.some(connection => connection.role === targetRole)) userIds.push(userId);
            }
          } else {
            userIds = onlineUserIds;
          }
        }

        const messages = [];
        for (const userId of userIds) {
          messages.push(await services.systemMessage.persistForUser(userId, { ...fields, targetRole: targetRole || null }));
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

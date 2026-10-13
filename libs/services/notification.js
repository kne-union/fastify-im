const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  Object.assign(fastify[options.name].services, {
    notification: {
      async sendOfflineNotification({ targetId, targetType, messageInfo, conversationInfo }) {
        if (!options.sendOfflineMessages) return;

        const interval = options.offlineNotifyInterval || 24;
        const since = new Date(Date.now() - interval * 60 * 60 * 1000);

        // 按 targetId + conversationId 去重，不同会话的通知互不影响
        const recentNotification = await models.notification.findOne({
          where: {
            targetId,
            conversationId: conversationInfo.id,
            createdAt: { [Op.gte]: since }
          }
        });

        if (recentNotification) return;

        let unreadCount = 0;
        if (targetType === 'user') {
          unreadCount = await services.message.getUnreadCount(targetId);
        } else {
          const unreadCounts = await services.message.getUnreadCountByConversation(conversationInfo.id);
          unreadCount = unreadCounts[targetId] || 0;
        }

        const sender = messageInfo.senderInfo || null;

        await options.sendOfflineMessages({
          targetId,
          targetType,
          messageInfo,
          conversationInfo,
          unreadCount,
          sender
        });

        await models.notification.create({
          targetId,
          targetType,
          conversationId: conversationInfo.id,
          messageType: messageInfo.type || 'im_offline',
          content: { messageInfo, conversationInfo }
        });
      }
    }
  });
});

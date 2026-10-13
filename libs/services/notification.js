const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];

  Object.assign(fastify[options.name].services, {
    notification: {
      async sendOfflineNotification({ targetId, targetType, messageInfo, conversationInfo }) {
        if (!options.sendOfflineMessages) return;

        const messageId = messageInfo?.id || messageInfo?.messageId || null;
        const conversationId = conversationInfo?.id || null;
        if (messageId) {
          const existing = await models.notification.findOne({
            where: { targetId, conversationId, messageId }
          });
          if (existing) return;
        }

        let unreadCount = 0;
        if (targetType === 'user') {
          unreadCount = await services.message.getUnreadCount(targetId);
        } else if (conversationId) {
          const unreadCounts = await services.message.getUnreadCountByConversation(conversationId);
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

        try {
          await models.notification.create({
            targetId,
            targetType,
            conversationId,
            messageId,
            messageType: messageInfo.type || 'im_offline',
            content: { messageInfo, conversationInfo }
          });
        } catch (error) {
          if (error?.name === 'SequelizeUniqueConstraintError') return;
          throw error;
        }
      }
    }
  });
});

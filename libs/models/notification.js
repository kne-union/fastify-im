module.exports = ({ DataTypes, definePrimaryType, options }) => {
  return {
    model: {
      targetId: {
        type: definePrimaryType(),
        comment: '通知目标ID(系统用户userId或访客conversationMember记录id)',
        allowNull: false
      },
      targetType: {
        type: DataTypes.STRING,
        comment: '目标类型: user-系统用户, guest-访客'
      },
      conversationId: {
        type: definePrimaryType(),
        comment: '会话ID',
        allowNull: true
      },
      messageId: {
        type: definePrimaryType(),
        comment: '消息ID，同一目标同一消息只通知一次',
        allowNull: true
      },
      messageType: {
        type: DataTypes.STRING,
        comment: '消息类型'
      },
      content: {
        type: DataTypes.JSONB,
        comment: '通知内容'
      },
      options: {
        type: DataTypes.JSONB,
        comment: '扩展字段'
      }
    },
    associate: () => {},
    options: {
      comment: 'IM通知记录表',
      indexes: [{ fields: ['target_id'] }, { fields: ['target_type'] }, { fields: ['conversation_id'] }, { fields: ['message_id'] }, { fields: ['target_id', 'conversation_id', 'message_id'], unique: true }, { fields: ['created_at'] }]
    }
  };
};

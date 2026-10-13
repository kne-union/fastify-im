module.exports = ({ DataTypes, definePrimaryType, options }) => {
  return {
    model: {
      senderRole: {
        type: DataTypes.STRING,
        comment: '发送者角色(string类型)'
      },
      content: {
        type: DataTypes.JSONB,
        comment: '消息内容: {type, value}'
      },
      type: {
        type: DataTypes.STRING,
        defaultValue: 'text',
        comment: '消息类型: text/img/audio/file/custom'
      },
      status: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '状态: 0-正常, 1-已撤回'
      },
      options: {
        type: DataTypes.JSONB,
        comment: '扩展字段'
      }
    },
    associate: ({ conversation, conversationMember, message }) => {
      message.belongsTo(conversation, { foreignKey: 'conversationId', as: 'conversation' });
      message.belongsTo(conversationMember, { foreignKey: 'senderId', as: 'sender' });
    },
    options: {
      comment: 'IM消息表',
      indexes: [{ fields: ['conversation_id'] }, { fields: ['sender_id'] }, { fields: ['created_at'] }]
    }
  };
};

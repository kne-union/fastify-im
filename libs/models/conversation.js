module.exports = ({ DataTypes, definePrimaryType, options }) => {
  return {
    model: {
      type: {
        type: DataTypes.STRING,
        defaultValue: 'single',
        comment: '会话类型: single-单聊, group-群聊'
      },
      name: {
        type: DataTypes.STRING,
        comment: '会话名称(群聊时使用)'
      },
      avatar: {
        type: DataTypes.STRING,
        comment: '会话头像(群聊时使用)'
      },
      lastSeq: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: '会话内已分配的最大序号'
      },
      options: {
        type: DataTypes.JSONB,
        comment: '扩展字段'
      }
    },
    associate: ({ conversation, conversationMember, message }) => {
      conversation.belongsTo(options.getUserModel(), {
        foreignKey: { name: 'createdBy', allowNull: true },
        as: 'creator'
      });
      conversation.hasMany(conversationMember, { foreignKey: 'conversationId', as: 'members' });
      conversation.hasMany(message, { foreignKey: 'conversationId', as: 'messages' });
    },
    options: {
      comment: 'IM会话表',
      indexes: [{ fields: ['type'] }, { fields: ['created_by'] }]
    }
  };
};

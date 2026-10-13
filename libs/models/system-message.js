module.exports = ({ DataTypes, definePrimaryType, options }) => {
  return {
    model: {
      type: {
        type: DataTypes.STRING,
        comment: '系统消息类型(string)'
      },
      title: {
        type: DataTypes.STRING,
        comment: '消息标题'
      },
      content: {
        type: DataTypes.JSON,
        comment: '消息内容'
      },
      dedupeKey: {
        type: DataTypes.STRING,
        comment: '业务去重键，同一用户只落一条'
      },
      targetRole: {
        type: DataTypes.STRING,
        comment: '目标角色(为空则不限角色)'
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '是否已读'
      },
      props: {
        type: DataTypes.JSON,
        comment: '附加属性'
      },
      options: {
        type: DataTypes.JSONB,
        comment: '扩展字段'
      }
    },
    associate: ({ systemMessage }) => {
      systemMessage.belongsTo(options.getUserModel(), { foreignKey: 'targetUserId', as: 'targetUser' });
    },
    options: {
      comment: 'IM系统消息表',
      indexes: [{ fields: ['target_user_id'] }, { fields: ['target_role'] }, { fields: ['is_read'] }, { fields: ['target_user_id', 'dedupe_key'], unique: true }]
    }
  };
};

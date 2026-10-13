module.exports = ({ DataTypes, definePrimaryType, options }) => {
  return {
    model: {
      role: {
        type: DataTypes.STRING,
        defaultValue: 'member',
        comment: '群内角色: owner/admin/member/guest'
      },
      nickname: {
        type: DataTypes.STRING,
        comment: '参与者昵称(访客必填，系统用户从user表获取)'
      },
      avatar: {
        type: DataTypes.STRING,
        comment: '参与者头像(访客必填，系统用户从user表获取)'
      },
      phone: {
        type: DataTypes.STRING,
        comment: '参与者电话(访客可选填写)'
      },
      email: {
        type: DataTypes.STRING,
        comment: '参与者邮箱(访客可选填写)'
      },
      lastReadMessageId: {
        type: definePrimaryType(),
        comment: '最后已读消息ID'
      },
      leftAt: {
        type: DataTypes.DATE,
        comment: '退出时间(null表示仍在群内)'
      },
      options: {
        type: DataTypes.JSONB,
        comment: '扩展字段'
      }
    },
    associate: ({ conversation, conversationMember }) => {
      conversationMember.belongsTo(conversation, { foreignKey: 'conversationId', as: 'conversation' });
      conversationMember.belongsTo(options.getUserModel(), {
        foreignKey: { name: 'userId', allowNull: true },
        as: 'user'
      });
    },
    options: {
      comment: 'IM会话成员表',
      indexes: [
        { fields: ['conversation_id'] },
        { fields: ['user_id'] },
        // 系统用户唯一约束: userId非null时按conversationId+userId去重
        // SQL中NULL不参与唯一约束，因此此索引仅对非null userId生效
        { fields: ['conversation_id', 'user_id'], unique: true, where: { deleted_at: null } },
        // 访客唯一约束: userId为null时按conversationId+nickname去重
        // 应用层在addMember()中也做了去重保护
        { fields: ['conversation_id', 'nickname'], unique: true, where: { deleted_at: null, role: 'guest' } }
      ]
    }
  };
};

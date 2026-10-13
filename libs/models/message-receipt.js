module.exports = ({ DataTypes, definePrimaryType }) => {
  return {
    model: {
      messageId: {
        type: definePrimaryType(),
        allowNull: false,
        comment: '消息ID'
      },
      memberId: {
        type: definePrimaryType(),
        allowNull: false,
        comment: '接收方成员ID'
      },
      recvAckAt: {
        type: DataTypes.DATE,
        comment: '本连接确认收到的时间'
      }
    },
    options: {
      comment: 'IM消息接收回执',
      indexes: [{ fields: ['message_id'] }, { fields: ['member_id'] }, { fields: ['message_id', 'member_id'], unique: true }]
    }
  };
};

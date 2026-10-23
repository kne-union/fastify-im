// 响应 schema 会参与 fast-json-stringify 序列化：对象一律 additionalProperties: true 以免裁掉未声明字段；
// 用 nullable 而非类型数组（类型数组遇到不匹配的值会直接 500），类型不确定的字段（如 id、日期、JSON 列）只写说明不声明类型
const str = description => ({ type: 'string', nullable: true, description });
const num = description => ({ type: 'number', nullable: true, description });
const bool = description => ({ type: 'boolean', nullable: true, description });
const any = description => ({ description });
const list = (description, items) => ({ type: 'array', nullable: true, description, items });
const obj = (description, properties = {}) => ({ type: 'object', nullable: true, description, additionalProperties: true, properties });

const timestamps = () => ({
  createdAt: any('创建时间'),
  updatedAt: any('更新时间')
});

const success = (description, schema) => ({
  200: Object.assign({}, schema || { type: 'object' }, { description })
});

const ok = (description = '操作成功') =>
  success(
    description,
    obj(description, {
      success: bool('固定为 true')
    })
  );

const MEMBER_ROLE = '群内角色：owner 群主，admin 管理员，member 成员，guest 访客';

const memberProperties = () =>
  Object.assign(
    {
      id: any('会话成员 ID'),
      conversationId: any('会话 ID'),
      userId: any('系统用户 ID，访客为 null'),
      role: str(MEMBER_ROLE),
      nickname: str('参与者昵称（访客使用，系统用户从用户表获取）'),
      avatar: str('参与者头像'),
      phone: str('参与者电话'),
      email: str('参与者邮箱'),
      lastReadMessageId: any('最后已读消息 ID'),
      lastReadSeq: num('最后已读序号'),
      leftAt: any('退出时间，null 表示仍在会话内'),
      options: any('扩展字段')
    },
    timestamps()
  );

const member = (description = '会话成员') => obj(description, memberProperties());

const message = (description = '消息', extra = {}) =>
  obj(
    description,
    Object.assign(
      {
        id: any('消息 ID'),
        conversationId: any('会话 ID'),
        senderId: any('发送者的会话成员 ID'),
        senderRole: str('发送者角色'),
        content: any('消息内容：{ type, value }'),
        clientMsgId: str('客户端消息号'),
        seq: any('会话内单调序号，0.2.0 之前的消息为 null'),
        traceId: str('业务链路号'),
        type: str('消息类型：text / img / audio / file / custom'),
        status: num('状态：0 正常，1 已撤回'),
        options: any('扩展字段')
      },
      timestamps(),
      extra
    )
  );

const conversationProperties = () =>
  Object.assign(
    {
      id: any('会话 ID'),
      type: str('会话类型：single 单聊，group 群聊'),
      name: str('会话名称（群聊）'),
      avatar: str('会话头像（群聊）'),
      lastSeq: num('会话内已分配的最大序号'),
      createdBy: any('创建者用户 ID'),
      options: any('扩展字段')
    },
    timestamps()
  );

const conversation = (description = '会话') => obj(description, conversationProperties());

const conversationListItem = obj(
  '会话',
  Object.assign(conversationProperties(), {
    members: list('仍在会话内的成员', member()),
    messages: list('最新一条消息（内部查询结果）', message()),
    unreadCount: num('当前用户在该会话的未读消息数（不含自己发送的）'),
    lastMessage: message('最新一条消息，没有消息时为 null'),
    lastReadMessageId: any('当前用户最后已读消息 ID')
  })
);

const memberListItem = obj(
  '会话成员',
  Object.assign(memberProperties(), {
    user: any('关联的系统用户记录，访客为 null'),
    name: str('显示名称：系统用户取 name / nickname / username，访客取 nickname'),
    isGuest: bool('是否为访客'),
    clientId: str('推送用的客户端 ID：系统用户为 userId，访客为 guest_{成员 ID}')
  })
);

const systemMessage = obj(
  '系统消息',
  Object.assign(
    {
      id: any('系统消息 ID'),
      type: str('系统消息类型'),
      title: str('标题'),
      content: any('消息内容'),
      dedupeKey: str('业务去重键'),
      targetRole: str('目标角色，为空不限角色'),
      targetUserId: any('接收用户 ID'),
      isRead: bool('是否已读'),
      props: any('附加属性'),
      options: any('扩展字段')
    },
    timestamps()
  )
);

module.exports = { str, num, bool, any, list, obj, success, ok, MEMBER_ROLE, member, message, conversation, conversationListItem, memberListItem, systemMessage };

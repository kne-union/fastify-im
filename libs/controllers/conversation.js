const fp = require('fastify-plugin');
const { list, obj, success, ok, forbidden, MEMBER_ROLE, member, conversation, conversationListItem, memberListItem } = require('../schema/response');

const TAG = 'IM-会话';
const MANAGER_ROLES = ['owner', 'admin'];
const ADMIN_ASSIGNABLE_ROLES = ['member', 'guest'];

const createForbiddenError = message => {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
};

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  // 只在 HTTP 层校验，service 方法保持原样供其它插件直接调用
  const getOperator = async (conversationId, userId) => {
    const operator = userId ? await services.conversation.getMemberByUserAndConversation(userId, conversationId) : null;
    if (!operator) throw createForbiddenError('Not a member of this conversation');
    const conv = await services.conversation.getConversationById(conversationId);
    if (!conv) throw createForbiddenError('Not a member of this conversation');
    return { operator, conv };
  };

  const assertGroupManager = ({ operator, conv }) => {
    if (conv.type !== 'group') throw createForbiddenError('Members of single conversation cannot be changed');
    if (!MANAGER_ROLES.includes(operator.role)) throw createForbiddenError('Only owner or admin can manage members');
  };

  fastify.get(
    `${options.prefix}/conversations`,
    {
      onRequest: options.getAuthenticate('conversation'),
      schema: {
        tags: [TAG],
        description: '获取当前用户仍在其中的会话列表，含成员、最新一条消息和未读数，按最新消息时间倒序（排序只在当前页内进行）',
        summary: '获取会话列表',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1, description: '页码' },
            pageSize: { type: 'number', default: 20, description: '每页数量' }
          }
        },
        response: success(
          '会话列表',
          obj('会话列表', {
            list: list('当前页会话列表', conversationListItem)
          })
        )
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const { page = 1, pageSize = 20 } = request.query;
      const list = await services.conversation.getConversations(userId, page, pageSize);
      return { list };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/single`,
    {
      onRequest: options.getAuthenticate('conversation:create'),
      schema: {
        tags: [TAG],
        description: '创建与对方用户的单聊会话；已存在则返回已有会话并重新激活已退出的成员。创建后向会话成员推送 conversationUpdated（action: created）',
        summary: '创建单聊',
        body: {
          type: 'object',
          required: ['targetUserId'],
          properties: {
            targetUserId: { type: 'string', description: '对方用户ID' }
          }
        },
        response: success('单聊会话', obj('创建结果', { conversation: conversation('单聊会话') }))
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const { targetUserId } = request.body;
      const conversation = await services.conversation.createSingleConversation(userId, targetUserId);

      await services.conversation.broadcastToConversation(conversation.id, 'conversationUpdated', {
        conversationId: conversation.id,
        action: 'created'
      });

      return { conversation };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/group`,
    {
      onRequest: options.getAuthenticate('conversation:create'),
      schema: {
        tags: [TAG],
        description: '创建群聊，当前用户为群主，memberIds 去重后作为普通成员加入。创建后向会话成员推送 conversationUpdated（action: created）',
        summary: '创建群聊',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: '群名称' },
            avatar: { type: 'string', description: '群头像' },
            memberIds: { type: 'array', items: { type: 'string' }, description: '初始成员ID列表' }
          }
        },
        response: success('群聊会话', obj('创建结果', { conversation: conversation('群聊会话') }))
      }
    },
    async request => {
      const userId = request.userInfo?.userId;
      const { name, avatar, memberIds } = request.body;
      const conversation = await services.conversation.createGroupConversation({
        name,
        avatar,
        creatorId: userId,
        memberIds
      });

      await services.conversation.broadcastToConversation(conversation.id, 'conversationUpdated', {
        conversationId: conversation.id,
        action: 'created'
      });

      return { conversation };
    }
  );

  fastify.get(
    `${options.prefix}/conversations/:id/members`,
    {
      onRequest: options.getAuthenticate('conversation'),
      schema: {
        tags: [TAG],
        description: '获取会话内仍未退出的成员，系统用户的名称和头像取自用户表；仅会话成员可查看，非成员或未登录返回 403',
        summary: '获取成员列表',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '会话 ID' }
          }
        },
        response: Object.assign(
          success(
            '成员列表',
            obj('成员列表', {
              members: list('成员列表', memberListItem)
            })
          ),
          forbidden('不是会话成员')
        )
      }
    },
    async request => {
      const { id } = request.params;
      await getOperator(id, request.userInfo?.userId);
      const members = await services.conversation.getMembers(id);
      return { members };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/:id/members`,
    {
      onRequest: options.getAuthenticate('conversation:manage'),
      schema: {
        tags: [TAG],
        description:
          '向群聊添加成员，仅群主（owner）和管理员（admin）可操作；单聊不允许添加成员。只有群主可以设置 owner / admin 角色，管理员只能添加 member / guest。当前用户不是会话成员、不是群主/管理员、管理员设置 owner / admin 角色或会话为单聊时返回 403。成员已在会话中则直接返回，曾退出则重新加入并更新角色、昵称、头像。完成后向该成员推送 conversationUpdated（action: added）',
        summary: '添加成员',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '会话 ID' }
          }
        },
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', description: '要添加的系统用户 ID' },
            role: { type: 'string', default: 'member', description: `${MEMBER_ROLE}；仅群主可设置 owner / admin` },
            nickname: { type: 'string', description: '参与者昵称(访客必填)' },
            avatar: { type: 'string', description: '参与者头像(访客必填)' }
          }
        },
        response: Object.assign(success('会话成员', obj('添加结果', { member: member() })), forbidden('无权添加成员'))
      }
    },
    async request => {
      const { id } = request.params;
      const operatorInfo = await getOperator(id, request.userInfo?.userId);
      assertGroupManager(operatorInfo);
      const { userId, role, nickname, avatar } = request.body;
      if (operatorInfo.operator.role !== 'owner' && !ADMIN_ASSIGNABLE_ROLES.includes(role)) {
        throw createForbiddenError('Only owner can assign this role');
      }
      const member = await services.conversation.addMember(id, userId, role, { nickname, avatar });
      const clientId = services.conversation.getMemberClientId(member);
      await services.ws.sendToUser(clientId, 'conversationUpdated', { conversationId: id, action: 'added' });
      return { member };
    }
  );

  fastify.delete(
    `${options.prefix}/conversations/:id/members/:userId`,
    {
      onRequest: options.getAuthenticate('conversation:manage'),
      schema: {
        tags: [TAG],
        description:
          '把系统用户标记为已退出会话，并向该用户推送 conversationUpdated（action: removed）；用户不在会话中时也返回成功。会话成员可以移除自己；移除他人仅限群聊：群主（owner）可移除 admin / member / guest，管理员（admin）只能移除 member / guest，任何人都不能移除群主。当前用户不是会话成员、越级移除、移除群主或在单聊中移除他人时返回 403',
        summary: '移除成员',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '会话 ID' },
            userId: { type: 'string', description: '要移除的系统用户 ID' }
          }
        },
        response: Object.assign(ok('移除成功'), forbidden('无权移除成员'))
      }
    },
    async request => {
      const { id, userId } = request.params;
      const operatorInfo = await getOperator(id, request.userInfo?.userId);
      if (operatorInfo.operator.userId !== userId) {
        assertGroupManager(operatorInfo);
        const target = await services.conversation.getMemberByUserAndConversation(userId, id);
        if (target && (target.role === 'owner' || (target.role === 'admin' && operatorInfo.operator.role !== 'owner'))) {
          throw createForbiddenError('Cannot remove a member with equal or higher role');
        }
      }
      await services.conversation.removeMember(id, userId);
      await services.ws.sendToUser(userId, 'conversationUpdated', { conversationId: id, action: 'removed' });
      return { success: true };
    }
  );

  fastify.post(
    `${options.prefix}/conversations/:id/leave`,
    {
      onRequest: options.getAuthenticate('conversation:leave'),
      schema: {
        tags: [TAG],
        description: '当前用户退出会话，并向自己推送 conversationUpdated（action: left）',
        summary: '退出群聊',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '会话 ID' }
          }
        },
        response: ok('退出成功')
      }
    },
    async request => {
      const { id } = request.params;
      const userId = request.userInfo?.userId;
      await services.conversation.leaveConversation(id, userId);
      await services.ws.sendToUser(userId, 'conversationUpdated', { conversationId: id, action: 'left' });
      return { success: true };
    }
  );

  fastify.put(
    `${options.prefix}/conversations/:id`,
    {
      onRequest: options.getAuthenticate('conversation:manage'),
      schema: {
        tags: [TAG],
        description: '更新会话名称和头像，未传的字段保持原值；完成后向会话成员推送 conversationUpdated（action: updated）。群聊仅群主（owner）和管理员（admin）可操作，单聊会话成员可操作，否则返回 403',
        summary: '更新会话',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '会话 ID' }
          }
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '会话名称' },
            avatar: { type: 'string', description: '会话头像' }
          }
        },
        response: Object.assign(ok('更新成功'), forbidden('无权修改会话'))
      }
    },
    async request => {
      const { id } = request.params;
      const { operator, conv } = await getOperator(id, request.userInfo?.userId);
      if (conv.type === 'group' && !MANAGER_ROLES.includes(operator.role)) {
        throw createForbiddenError('Only owner or admin can update group conversation');
      }
      const { name, avatar } = request.body;
      await services.conversation.updateConversation(id, { name, avatar });

      await services.conversation.broadcastToConversation(id, 'conversationUpdated', {
        conversationId: id,
        action: 'updated'
      });

      return { success: true };
    }
  );
});

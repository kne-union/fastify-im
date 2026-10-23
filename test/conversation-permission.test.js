const { expect, createTestApp, cleanupApp } = require('./helpers');

const getAuthenticate = () => [
  async request => {
    const userId = request.headers['x-user-id'];
    if (userId) request.userInfo = { userId };
  }
];

describe('会话 HTTP 接口权限', function () {
  this.timeout(10000);
  let app, uid, groupId, singleId;

  const as = (userId, opts) => app.inject(Object.assign({}, opts, { headers: userId ? { 'x-user-id': userId } : {} }));

  const setRole = async (userId, role) => {
    const member = await app.im.services.conversation.getMemberByUserAndConversation(userId, groupId);
    await member.update({ role });
  };

  const addMember = (operatorId, payload) => as(operatorId, { method: 'POST', url: `/im/conversations/${groupId}/members`, payload });
  const removeMember = (operatorId, targetId) => as(operatorId, { method: 'DELETE', url: `/im/conversations/${groupId}/members/${targetId}` });

  beforeEach(async () => {
    app = await createTestApp({ getAuthenticate });
    uid = app._userIdMap;
    const { conversation } = app.im.services;
    const group = await conversation.createGroupConversation({ name: 'G', creatorId: uid.user1, memberIds: [uid.user2] });
    groupId = group.id;
    const single = await conversation.createSingleConversation(uid.user1, uid.user2);
    singleId = single.id;
  });

  afterEach(async () => {
    await cleanupApp(app);
  });

  describe('添加成员', () => {
    it('非成员添加成员返回 403', async () => {
      const res = await as(uid.user3, { method: 'POST', url: `/im/conversations/${groupId}/members`, payload: { userId: uid.user3 } });
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(groupId, uid.user3)).to.equal(false);
    });

    it('未登录添加成员返回 403', async () => {
      const res = await as(null, { method: 'POST', url: `/im/conversations/${groupId}/members`, payload: { userId: uid.user3 } });
      expect(res.statusCode).to.equal(403);
    });

    it('普通成员拉人返回 403', async () => {
      const res = await as(uid.user2, { method: 'POST', url: `/im/conversations/${groupId}/members`, payload: { userId: uid.user3 } });
      expect(res.statusCode).to.equal(403);
      expect(res.json().message).to.be.a('string');
      expect(await app.im.services.conversation.isMember(groupId, uid.user3)).to.equal(false);
    });

    it('群主拉人成功', async () => {
      const res = await as(uid.user1, { method: 'POST', url: `/im/conversations/${groupId}/members`, payload: { userId: uid.user3 } });
      expect(res.statusCode).to.equal(200);
      expect(res.json().member.userId).to.equal(uid.user3);
      expect(await app.im.services.conversation.isMember(groupId, uid.user3)).to.equal(true);
    });

    it('管理员拉人成功', async () => {
      const admin = await app.im.services.conversation.getMemberByUserAndConversation(uid.user2, groupId);
      await admin.update({ role: 'admin' });
      const res = await as(uid.user2, { method: 'POST', url: `/im/conversations/${groupId}/members`, payload: { userId: uid.user3 } });
      expect(res.statusCode).to.equal(200);
    });

    it('单聊不允许通过 HTTP 添加成员', async () => {
      const res = await as(uid.user1, { method: 'POST', url: `/im/conversations/${singleId}/members`, payload: { userId: uid.user3 } });
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(singleId, uid.user3)).to.equal(false);
    });

    it('service.addMember 内部调用不受影响', async () => {
      const member = await app.im.services.conversation.addMember(singleId, uid.user3);
      expect(member.userId).to.equal(uid.user3);
    });
  });

  describe('移除成员', () => {
    it('成员移除自己（退出）成功', async () => {
      const res = await as(uid.user2, { method: 'DELETE', url: `/im/conversations/${groupId}/members/${uid.user2}` });
      expect(res.statusCode).to.equal(200);
      expect(await app.im.services.conversation.isMember(groupId, uid.user2)).to.equal(false);
    });

    it('普通成员移除他人返回 403', async () => {
      const res = await as(uid.user2, { method: 'DELETE', url: `/im/conversations/${groupId}/members/${uid.user1}` });
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(groupId, uid.user1)).to.equal(true);
    });

    it('非成员移除他人返回 403', async () => {
      const res = await as(uid.user3, { method: 'DELETE', url: `/im/conversations/${groupId}/members/${uid.user2}` });
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(groupId, uid.user2)).to.equal(true);
    });

    it('群主移除他人成功', async () => {
      const res = await as(uid.user1, { method: 'DELETE', url: `/im/conversations/${groupId}/members/${uid.user2}` });
      expect(res.statusCode).to.equal(200);
      expect(await app.im.services.conversation.isMember(groupId, uid.user2)).to.equal(false);
    });

    it('单聊不允许移除对方', async () => {
      const res = await as(uid.user1, { method: 'DELETE', url: `/im/conversations/${singleId}/members/${uid.user2}` });
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(singleId, uid.user2)).to.equal(true);
    });
  });

  describe('添加成员的角色', () => {
    it('管理员设置 owner 角色返回 403', async () => {
      await setRole(uid.user2, 'admin');
      const res = await addMember(uid.user2, { userId: uid.user3, role: 'owner' });
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(groupId, uid.user3)).to.equal(false);
    });

    it('管理员设置 admin 角色返回 403', async () => {
      await setRole(uid.user2, 'admin');
      const res = await addMember(uid.user2, { userId: uid.user3, role: 'admin' });
      expect(res.statusCode).to.equal(403);
    });

    it('管理员不传 role 时按默认 member 添加成功', async () => {
      await setRole(uid.user2, 'admin');
      const res = await addMember(uid.user2, { userId: uid.user3 });
      expect(res.statusCode).to.equal(200);
      expect(res.json().member.role).to.equal('member');
    });

    it('管理员添加 guest 成功', async () => {
      await setRole(uid.user2, 'admin');
      const res = await addMember(uid.user2, { userId: uid.user3, role: 'guest' });
      expect(res.statusCode).to.equal(200);
      expect(res.json().member.role).to.equal('guest');
    });

    it('群主设置 admin 角色成功', async () => {
      const res = await addMember(uid.user1, { userId: uid.user3, role: 'admin' });
      expect(res.statusCode).to.equal(200);
      expect(res.json().member.role).to.equal('admin');
    });
  });

  describe('移除成员的角色高低', () => {
    beforeEach(async () => {
      await app.im.services.conversation.addMember(groupId, uid.user3);
      await app.im.services.conversation.addMember(groupId, uid.agent1, 'admin');
    });

    it('管理员移除管理员返回 403', async () => {
      await setRole(uid.user2, 'admin');
      const res = await removeMember(uid.user2, uid.agent1);
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(groupId, uid.agent1)).to.equal(true);
    });

    it('管理员移除群主返回 403', async () => {
      const res = await removeMember(uid.agent1, uid.user1);
      expect(res.statusCode).to.equal(403);
      expect(await app.im.services.conversation.isMember(groupId, uid.user1)).to.equal(true);
    });

    it('群主不能被其他群主移除', async () => {
      await setRole(uid.user2, 'owner');
      const res = await removeMember(uid.user2, uid.user1);
      expect(res.statusCode).to.equal(403);
    });

    it('管理员移除普通成员成功', async () => {
      const res = await removeMember(uid.agent1, uid.user3);
      expect(res.statusCode).to.equal(200);
      expect(await app.im.services.conversation.isMember(groupId, uid.user3)).to.equal(false);
    });

    it('群主移除管理员成功', async () => {
      const res = await removeMember(uid.user1, uid.agent1);
      expect(res.statusCode).to.equal(200);
      expect(await app.im.services.conversation.isMember(groupId, uid.agent1)).to.equal(false);
    });

    it('群主移除自己（退出）保持成功', async () => {
      const res = await removeMember(uid.user1, uid.user1);
      expect(res.statusCode).to.equal(200);
      expect(await app.im.services.conversation.isMember(groupId, uid.user1)).to.equal(false);
    });
  });

  describe('成员列表', () => {
    it('非成员查看成员列表返回 403', async () => {
      const res = await as(uid.user3, { method: 'GET', url: `/im/conversations/${groupId}/members` });
      expect(res.statusCode).to.equal(403);
    });

    it('未登录查看成员列表返回 403', async () => {
      const res = await as(null, { method: 'GET', url: `/im/conversations/${groupId}/members` });
      expect(res.statusCode).to.equal(403);
    });

    it('成员查看成员列表成功', async () => {
      const res = await as(uid.user2, { method: 'GET', url: `/im/conversations/${groupId}/members` });
      expect(res.statusCode).to.equal(200);
      expect(res.json().members.map(item => item.userId)).to.have.members([uid.user1, uid.user2]);
    });
  });

  describe('修改会话', () => {
    it('非成员修改会话返回 403', async () => {
      const res = await as(uid.user3, { method: 'PUT', url: `/im/conversations/${groupId}`, payload: { name: 'hacked' } });
      expect(res.statusCode).to.equal(403);
      expect((await app.im.services.conversation.getConversationById(groupId)).name).to.equal('G');
    });

    it('普通成员修改群聊返回 403', async () => {
      const res = await as(uid.user2, { method: 'PUT', url: `/im/conversations/${groupId}`, payload: { name: 'hacked' } });
      expect(res.statusCode).to.equal(403);
      expect((await app.im.services.conversation.getConversationById(groupId)).name).to.equal('G');
    });

    it('群主修改群聊成功', async () => {
      const res = await as(uid.user1, { method: 'PUT', url: `/im/conversations/${groupId}`, payload: { name: 'G2' } });
      expect(res.statusCode).to.equal(200);
      expect((await app.im.services.conversation.getConversationById(groupId)).name).to.equal('G2');
    });

    it('单聊成员修改会话成功', async () => {
      const res = await as(uid.user2, { method: 'PUT', url: `/im/conversations/${singleId}`, payload: { name: 'S' } });
      expect(res.statusCode).to.equal(200);
      expect((await app.im.services.conversation.getConversationById(singleId)).name).to.equal('S');
    });
  });

  describe('消息历史', () => {
    it('非成员读取消息历史返回 403', async () => {
      const res = await as(uid.user3, { method: 'GET', url: `/im/conversations/${groupId}/messages` });
      expect(res.statusCode).to.equal(403);
    });

    it('成员读取消息历史成功', async () => {
      const res = await as(uid.user2, { method: 'GET', url: `/im/conversations/${groupId}/messages` });
      expect(res.statusCode).to.equal(200);
      expect(res.json().list).to.be.an('array');
    });
  });
});

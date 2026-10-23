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

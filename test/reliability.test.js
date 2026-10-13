const { createTestApp, cleanupApp, expect } = require('./helpers');
const { ReliableSender, missingSeqs, delayFor } = require('../libs/client/reliable-send');

describe('可靠投递', function () {
  let app, uid, convId, senderMemberId, receiverMemberId;

  beforeEach(async () => {
    app = await createTestApp();
    uid = app._userIdMap;
    const conv = await app.im.services.conversation.createSingleConversation(uid.user1, uid.user2);
    convId = conv.id;
    senderMemberId = (await app.im.services.conversation.getMemberByUserAndConversation(uid.user1, convId)).id;
    receiverMemberId = (await app.im.services.conversation.getMemberByUserAndConversation(uid.user2, convId)).id;
  });

  afterEach(async () => {
    await cleanupApp(app);
  });

  it('同一 clientMsgId 只落一条并保持 seq', async () => {
    const first = await app.im.services.message.sendMessage({
      conversationId: convId,
      senderMemberId,
      content: 'hello',
      type: 'text',
      clientMsgId: 'c1',
      traceId: 't1'
    });
    const second = await app.im.services.message.sendMessage({
      conversationId: convId,
      senderMemberId,
      content: 'hello again',
      type: 'text',
      clientMsgId: 'c1',
      traceId: 't1'
    });
    expect(second.id).to.equal(first.id);
    expect(second.seq).to.equal(first.seq);
    expect(second.duplicated).to.equal(true);
    const history = await app.im.services.message.getMessageHistory(convId, senderMemberId);
    expect(history).to.have.length(1);
  });

  it('seq 按会话递增，已读位置只前进', async () => {
    const first = await app.im.services.message.sendMessage({
      conversationId: convId,
      senderMemberId,
      content: 'a',
      type: 'text',
      clientMsgId: 'a'
    });
    const second = await app.im.services.message.sendMessage({
      conversationId: convId,
      senderMemberId,
      content: 'b',
      type: 'text',
      clientMsgId: 'b'
    });
    expect(second.seq).to.equal(first.seq + 1);
    await app.im.services.message.readMessages(convId, receiverMemberId, second.id);
    const backward = await app.im.services.message.readMessages(convId, receiverMemberId, first.id);
    expect(backward.advanced).to.equal(false);
    const member = await app.im.services.conversation.getMemberById(receiverMemberId);
    expect(member.lastReadSeq).to.equal(second.seq);
    const unread = await app.im.services.message.getUnreadCount(uid.user2);
    expect(unread).to.equal(0);
  });

  it('recvAck 只记一次，readAck 可按 seq 推进', async () => {
    const message = await app.im.services.message.sendMessage({
      conversationId: convId,
      senderMemberId,
      content: 'ack',
      type: 'text',
      clientMsgId: 'ack'
    });
    await app.im.services.message.recvAck({ messageId: message.id, memberId: receiverMemberId });
    await app.im.services.message.recvAck({ messageId: message.id, memberId: receiverMemberId });
    const receipts = await app.im.models.messageReceipt.count({ where: { messageId: message.id, memberId: receiverMemberId } });
    expect(receipts).to.equal(1);
    const read = await app.im.services.message.readMessages(convId, receiverMemberId, null, message.seq);
    expect(read.advanced).to.equal(true);
  });

  it('系统消息 dedupeKey 对同一用户只落一条', async () => {
    const first = await app.im.services.systemMessage.pushSystemMessage({
      type: 'ticket',
      title: '新工单',
      content: { id: 1 },
      targetUserId: uid.user1,
      dedupeKey: 'ticket:1'
    });
    const second = await app.im.services.systemMessage.pushSystemMessage({
      type: 'ticket',
      title: '新工单',
      content: { id: 1 },
      targetUserId: uid.user1,
      dedupeKey: 'ticket:1'
    });
    expect(second[0].id).to.equal(first[0].id);
    const count = await app.im.models.systemMessage.count({ where: { targetUserId: uid.user1, dedupeKey: 'ticket:1' } });
    expect(count).to.equal(1);
  });
});

describe('进程指标与统计采集', function () {
  it('GET /metrics 由 fastify-statistics 输出在线连接和消息计数', async () => {
    const app = await createTestApp();
    try {
      const uid = app._userIdMap;
      const conv = await app.im.services.conversation.createSingleConversation(uid.user1, uid.user2);
      const member = await app.im.services.conversation.getMemberByUserAndConversation(uid.user1, conv.id);
      await app.im.services.message.sendMessage({
        conversationId: conv.id,
        senderMemberId: member.id,
        content: 'm',
        type: 'text',
        clientMsgId: 'stat-1'
      });
      const response = await app.inject({ method: 'GET', url: '/im/metrics' });
      expect(response.statusCode).to.equal(200);
      expect(response.body).to.contain('im_online_connections');
      expect(response.body).to.match(/im_messages_total\{[^}]*\} 1/);
      const collected = await app.statistics.models.dataRecord.findAll({
        where: { channel: 'im', attributeName: 'messages' }
      });
      expect(collected).to.have.length(1);
    } finally {
      await cleanupApp(app);
    }
  });
});

describe('客户端重试', function () {
  it('未收到 sendAck 时按退避重发同一 clientMsgId', () => {
    const sent = [];
    const timers = [];
    const sender = new ReliableSender({
      send: frame => sent.push(frame),
      baseDelay: 1000,
      maxDelay: 30000,
      maxAttempts: 3,
      schedule: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clear: () => {}
    });
    sender.enqueue({ conversationId: 'c', clientMsgId: 'm1', content: 'hi', type: 'text', traceId: 't' });
    expect(sent).to.have.length(1);
    expect(sent[0].payload.clientMsgId).to.equal('m1');
    expect(sent[0].payload.retry).to.equal(0);
    expect(timers[0].ms).to.equal(delayFor(1, 1000, 30000));
    timers[0].fn();
    expect(sent[1].payload.retry).to.equal(1);
    expect(sent[1].payload.clientMsgId).to.equal('m1');
    expect(sender.ack({ clientMsgId: 'm1' })).to.equal(true);
    expect(sender.pendingIds()).to.eql([]);
    sender.close();
  });

  it('按 seq 找出缺口', () => {
    expect(missingSeqs([{ seq: 1 }, { seq: 2 }, { seq: 5 }])).to.eql([3, 4]);
  });
});

function delayFor(attempt, baseDelay, maxDelay) {
  return Math.min(baseDelay * 2 ** Math.max(0, attempt - 1), maxDelay);
}

function missingSeqs(messages) {
  const seqs = (messages || [])
    .map(message => message && message.seq)
    .filter(seq => Number.isInteger(seq))
    .sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < seqs.length; i += 1) {
    for (let seq = seqs[i - 1] + 1; seq < seqs[i]; seq += 1) gaps.push(seq);
  }
  return gaps;
}

class ReliableSender {
  constructor({ send, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), clear = id => clearTimeout(id), baseDelay = 1000, maxDelay = 30000, maxAttempts = 5, onGiveUp } = {}) {
    if (typeof send !== 'function') throw new Error('send is required');
    this.send = send;
    this.now = now;
    this.schedule = schedule;
    this.clear = clear;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.maxAttempts = maxAttempts;
    this.onGiveUp = onGiveUp;
    this.pending = new Map();
  }

  enqueue(payload) {
    if (!payload || !payload.clientMsgId || !payload.conversationId) {
      throw new Error('clientMsgId and conversationId are required');
    }
    if (this.pending.has(payload.clientMsgId)) return false;
    const item = { payload, attempt: 0, timer: null };
    this.pending.set(payload.clientMsgId, item);
    this.dispatch(item);
    return true;
  }

  ack(body) {
    const clientMsgId = body && body.clientMsgId;
    const item = this.pending.get(clientMsgId);
    if (!item) return false;
    if (item.timer) this.clear(item.timer);
    this.pending.delete(clientMsgId);
    return true;
  }

  pendingIds() {
    return [...this.pending.keys()];
  }

  dispatch(item) {
    item.attempt += 1;
    this.send({
      type: 'sendMessage',
      traceId: item.payload.traceId,
      payload: {
        ...item.payload,
        retry: item.attempt - 1,
        sentAt: this.now()
      }
    });
    const wait = delayFor(item.attempt, this.baseDelay, this.maxDelay);
    item.timer = this.schedule(() => {
      if (!this.pending.has(item.payload.clientMsgId)) return;
      if (item.attempt >= this.maxAttempts) {
        this.pending.delete(item.payload.clientMsgId);
        if (this.onGiveUp) this.onGiveUp(item.payload);
        return;
      }
      this.dispatch(item);
    }, wait);
  }

  close() {
    this.pending.forEach(item => {
      if (item.timer) this.clear(item.timer);
    });
    this.pending.clear();
  }
}

module.exports = { ReliableSender, missingSeqs, delayFor };

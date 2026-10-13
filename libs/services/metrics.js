const fp = require('fastify-plugin');

const COUNTERS = {
  'im:message': 'im_messages',
  'im:message:duplicate': 'im_duplicates',
  'im:recv_ack': 'im_recv_acks',
  'im:send_retry': 'im_send_retries'
};

const COLLECT_ATTR = {
  'im:message': 'messages',
  'im:message:duplicate': 'duplicates',
  'im:recv_ack': 'recvAcks',
  'im:send_retry': 'sendRetries'
};

module.exports = fp(async (fastify, options) => {
  function registry() {
    const metrics = fastify.statistics?.services?.metrics;
    if (!metrics) throw new Error('fastify-statistics 未注册');
    return metrics;
  }

  function record(channel, value = 1) {
    const name = COUNTERS[channel] || String(channel).replace(/[^a-zA-Z0-9_]/g, '_');
    registry().inc(name, null, value);
    const attr = COLLECT_ATTR[channel];
    const collect = fastify.statistics?.services?.collect;
    if (!attr || typeof collect !== 'function') return;
    return collect({
      channel: 'im',
      data: { [attr]: value },
      unit: 'count',
      time: new Date()
    }).catch(error => {
      fastify.log?.warn({ err: error, channel }, 'im statistics collect failed');
    });
  }

  function render(gauges = {}) {
    const metrics = registry();
    Object.entries(gauges).forEach(([name, value]) => {
      metrics.set(name, value);
    });
    return metrics.render();
  }

  Object.assign(fastify[options.name].services, {
    metrics: {
      inc: (name, labels, by) => registry().inc(name, labels, by),
      record,
      observeSendAck: ms => registry().observe('im_send_ack_ms', ms),
      render
    }
  });
});

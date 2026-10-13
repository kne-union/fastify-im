const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(`${options.prefix}/ws`, { websocket: true }, async (socket, request) => {
    const token = request.headers['sec-websocket-protocol'] || request.query?.token;

    if (!token) {
      socket.close(4001, 'Authentication required');
      return;
    }

    let clientInfo = null;
    let socketId = null;
    const pending = [];

    // @fastify/websocket：必须在任何 await 之前挂上 message，否则握手后立刻到达的帧会被丢弃
    socket.on('message', async raw => {
      if (!clientInfo) {
        pending.push(raw);
        return;
      }
      await dispatch(raw);
    });

    socket.on('close', async () => {
      if (!socketId || !clientInfo) return;
      try {
        await services.ws.onDisconnect(socketId, clientInfo);
      } catch (e) {}
    });

    async function dispatch(raw) {
      try {
        const data = JSON.parse(raw);
        await services.ws.handleMessage(data, clientInfo);
      } catch (e) {
        try {
          socket.send(JSON.stringify({ type: 'error', payload: { message: e.message } }));
        } catch (err) {}
      }
    }

    const authResult = await services.ws.authenticate(token);

    if (authResult.error) {
      socket.close(authResult.error.code, authResult.error.reason);
      return;
    }

    clientInfo = authResult;
    const created = await services.ws.create(socket, clientInfo);
    socketId = created.socketId;

    await services.ws.onConnect(clientInfo, socketId, created.wasFirstConnection);

    const queued = pending.splice(0);
    for (const raw of queued) {
      await dispatch(raw);
    }
  });
});

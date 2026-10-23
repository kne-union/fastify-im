const fp = require('fastify-plugin');
const { clientMessage } = require('../client-message');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/ws`,
    {
      websocket: true,
      schema: {
        tags: ['IM-WebSocket'],
        summary: 'IM WebSocket 连接',
        description:
          'WebSocket 长连接入口（需宿主注册 @fastify/websocket）。令牌从 Sec-WebSocket-Protocol 请求头或 query.token 读取，由 options.verifyToken 校验；缺少令牌关闭码 4001，校验失败按返回的错误码关闭。连接后通过 JSON 帧收发消息，处理出错时回发 { type: error, payload: { message } }',
        querystring: {
          type: 'object',
          properties: {
            token: { description: '身份令牌，未通过 Sec-WebSocket-Protocol 请求头传递时使用' }
          }
        },
        headers: {
          type: 'object',
          properties: {
            'sec-websocket-protocol': { description: '身份令牌，优先于 query.token' }
          }
        },
        response: {
          200: { description: '升级为 WebSocket 连接，不返回 HTTP 响应体' }
        }
      }
    },
    async (socket, request) => {
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

      socket.on('close', async code => {
        services.metrics?.inc('im_ws_close_total', { code: String(code || 0) });
        fastify.log?.info({ code: code || 0, userId: clientInfo?.userId, instanceId: options.instanceId }, 'ws closed');
        if (!socketId || !clientInfo) return;
        try {
          await services.ws.onDisconnect(socketId, clientInfo);
        } catch (error) {
          fastify.log?.warn({ err: error, userId: clientInfo.userId }, 'ws disconnect cleanup failed');
        }
      });

      async function dispatch(raw) {
        try {
          const data = JSON.parse(raw);
          await services.ws.handleMessage(data, clientInfo);
        } catch (error) {
          fastify.log?.error({ err: error, userId: clientInfo?.userId }, 'ws message failed');
          try {
            socket.send(JSON.stringify({ type: 'error', payload: { message: clientMessage(error) } }));
          } catch (sendError) {
            fastify.log?.warn({ err: sendError }, 'ws error frame failed');
          }
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
    }
  );
});

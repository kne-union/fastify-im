const fp = require('fastify-plugin');
const crypto = require('node:crypto');
const { clientMessage } = require('../client-message');

/**
 * 内存存储适配器 - 默认实现
 * 符合 ConnectionStore 接口规范，可替换为 Redis 等外部实现
 */
class MemoryConnectionStore {
  constructor() {
    this._connections = new Map(); // socketId → connection
    this._userSockets = new Map(); // userId → Set<socketId>
  }

  async addConnection(socketId, connection) {
    this._connections.set(socketId, connection);
    if (!this._userSockets.has(connection.userId)) {
      this._userSockets.set(connection.userId, new Set());
    }
    const wasFirst = this._userSockets.get(connection.userId).size === 0;
    this._userSockets.get(connection.userId).add(socketId);
    return { wasFirstConnection: wasFirst };
  }

  async removeConnection(socketId) {
    const connection = this._connections.get(socketId);
    if (!connection) return null;

    this._connections.delete(socketId);
    const sockets = this._userSockets.get(connection.userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this._userSockets.delete(connection.userId);
        return { userId: connection.userId, isFullyOffline: true };
      }
    }
    return { userId: connection.userId, isFullyOffline: false };
  }

  async getConnection(socketId) {
    return this._connections.get(socketId) || null;
  }

  async getUserConnectionIds(userId) {
    const sockets = this._userSockets.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  async isUserOnline(userId) {
    return this._userSockets.has(userId) && this._userSockets.get(userId).size > 0;
  }

  async getOnlineUserIds() {
    return Array.from(this._userSockets.keys());
  }

  async getOnlineCount() {
    return this._userSockets.size;
  }

  async getAllConnections() {
    return Array.from(this._connections.values());
  }
}

/**
 * ConnectionStore 接口规范:
 *
 * async addConnection(socketId, connection) → {wasFirstConnection: boolean}
 *   添加连接记录，connection = {socket, userId, role, clientInfo, alive, heartbeatTimer}
 *
 * async removeConnection(socketId) → {userId, isFullyOffline: boolean} | null
 *   移除连接记录，返回移除结果
 *
 * async getConnection(socketId) → connection | null
 *   获取单个连接
 *
 * async getUserConnectionIds(userId) → string[]
 *   获取用户所有连接ID
 *
 * async isUserOnline(userId) → boolean
 *   判断用户是否在线
 *
 * async getOnlineUserIds() → string[]
 *   获取所有在线用户ID
 *
 * async getOnlineCount() → number
 *   获取在线用户数
 */

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];
  const heartbeatInterval = options.heartbeatInterval || 30000;
  const store = options.connectionStore || new MemoryConnectionStore();

  Object.assign(fastify[options.name].services, {
    ws: {
      // ── 认证 ──

      async authenticate(token) {
        // 1. 尝试 verifyToken (系统用户)
        if (options.verifyToken) {
          try {
            const clientInfo = await options.verifyToken(token);
            if (clientInfo) return clientInfo;
          } catch (error) {
            fastify.log?.warn({ err: error }, 'verifyToken failed');
            return { error: { code: 4003, reason: 'Authentication failed' } };
          }
        }

        // 2. 尝试 shorten token (访客)
        if (fastify.shorten) {
          try {
            const decoded = JSON.parse(await fastify.shorten.services.decode(token));
            if (decoded.target !== 'im') {
              return { error: { code: 4002, reason: 'Invalid token target' } };
            }

            const { conversationId, memberId, nickname, avatar, recipientUserId } = decoded;

            if (conversationId && memberId) {
              const member = await services.conversation.getMemberById(memberId);
              if (!member || member.conversationId !== conversationId) {
                return { error: { code: 4002, reason: 'Invalid guest token' } };
              }
              return {
                userId: `guest_${member.id}`,
                memberId: member.id,
                conversationId: member.conversationId,
                role: member.role,
                nickname: member.nickname,
                avatar: member.avatar,
                isGuest: true
              };
            } else {
              // 新建会话的访客令牌 (来自 /guest-access)
              const result = await services.conversation.findOrCreateGuestConversation({
                recipientUserId,
                nickname,
                avatar
              });
              // 更新内容到shorten
              await fastify.shorten.services.update(token, {
                conversationId: result.conversation.id,
                memberId: result.guestMember.id
              });
              return {
                userId: `guest_${result.guestMember.id}`,
                memberId: result.guestMember.id,
                conversationId: result.conversation.id,
                role: 'guest',
                nickname,
                avatar,
                isGuest: true
              };
            }
          } catch (error) {
            fastify.log?.warn({ err: error }, 'shorten token decode failed');
          }
        }

        return { error: { code: 4003, reason: 'Authentication failed' } };
      },

      // ── 连接生命周期 ──

      async create(socket, clientInfo) {
        const socketId = `${clientInfo.userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const connection = {
          socket,
          userId: clientInfo.userId,
          role: clientInfo.role,
          clientInfo,
          alive: true,
          heartbeatTimer: setInterval(() => {
            const writable = typeof socket.readyState !== 'number' || socket.readyState === 1;
            if (!writable) {
              services.metrics?.inc('im_zombie_connection_total');
              fastify.log?.warn({ userId: clientInfo.userId, instanceId: options.instanceId }, 'zombie socket');
              clearInterval(connection.heartbeatTimer);
              try {
                socket.close(4004, 'Heartbeat timeout');
              } catch (error) {
                fastify.log?.warn({ err: error, userId: clientInfo.userId }, 'zombie socket close failed');
              }
              return;
            }
            if (!connection.alive) {
              services.metrics?.inc('im_heartbeat_timeout_total');
              fastify.log?.warn({ userId: clientInfo.userId, instanceId: options.instanceId }, 'heartbeat timeout');
              clearInterval(connection.heartbeatTimer);
              try {
                socket.close(4004, 'Heartbeat timeout');
              } catch (error) {
                fastify.log?.warn({ err: error, userId: clientInfo.userId }, 'heartbeat close failed');
              }
              return;
            }
            connection.alive = false;
            try {
              socket.ping();
            } catch (error) {
              fastify.log?.warn({ err: error, userId: clientInfo.userId }, 'heartbeat ping failed');
            }
          }, heartbeatInterval)
        };

        socket.on('pong', () => {
          connection.alive = true;
        });

        const result = await store.addConnection(socketId, connection);

        return { socketId, wasFirstConnection: result.wasFirstConnection };
      },

      async remove(socketId) {
        const connection = await store.getConnection(socketId);
        if (!connection) return null;

        if (connection.heartbeatTimer) {
          clearInterval(connection.heartbeatTimer);
        }

        return store.removeConnection(socketId);
      },

      async onConnect(clientInfo, socketId, wasFirstConnection) {
        await services.ws.sendToUser(clientInfo.userId, 'connected', {
          userId: clientInfo.userId,
          role: clientInfo.role
        });

        // 系统用户上线时推送未读系统消息数
        if (!clientInfo.isGuest) {
          await services.ws.pushUnreadSystemCount(clientInfo.userId);
        }

        if (wasFirstConnection) {
          await services.ws.broadcastOnlineStatus(clientInfo, true);
        }
      },

      async onDisconnect(socketId, clientInfo) {
        const result = await services.ws.remove(socketId);
        if (result && result.isFullyOffline) {
          await services.ws.broadcastOnlineStatus(clientInfo, false);
        }
      },

      // ── 消息路由 ──

      async handleMessage(data, clientInfo) {
        const { type, payload } = data || {};

        switch (type) {
          case 'getUserInfo':
            return services.ws.handleGetUserInfo(clientInfo);

          case 'getConversations':
            return services.ws.handleGetConversations(clientInfo, payload);

          case 'sendMessage':
            return services.ws.handleSendMessage(clientInfo, payload, data.traceId);

          case 'recvAck':
            return services.ws.handleRecvAck(clientInfo, payload);

          case 'readAck':
          case 'readMessages':
            return services.ws.handleReadMessages(clientInfo, payload);

          case 'revokeMessage':
            return services.ws.handleRevokeMessage(clientInfo, payload);

          case 'getMessageHistory':
            return services.ws.handleGetMessageHistory(clientInfo, payload);

          case 'getUnreadCount':
            return services.ws.handleGetUnreadCount(clientInfo);

          case 'typing':
          case 'typingEnd':
            return services.ws.handleTyping(clientInfo, payload, type);

          case 'getOnlineUsers':
            return services.ws.handleGetOnlineUsers(clientInfo, payload);

          default:
            await services.ws.sendToUser(clientInfo.userId, 'error', {
              message: `Unknown event type: ${type}`
            });
        }
      },

      // ── 消息发送 ──

      async sendToUser(userId, type, payload) {
        const connectionIds = await store.getUserConnectionIds(userId);
        if (!connectionIds || connectionIds.length === 0) return false;

        const message = JSON.stringify({ type, payload });
        for (const socketId of connectionIds) {
          const connection = await store.getConnection(socketId);
          if (connection) {
            try {
              connection.socket.send(message);
            } catch (error) {
              fastify.log?.warn({ err: error, userId }, 'ws send failed');
            }
          }
        }
        return true;
      },

      // ── 在线状态 ──

      async isOnline(userId) {
        return store.isUserOnline(userId);
      },

      async getOnlineUserIds() {
        return store.getOnlineUserIds();
      },

      async getConnection(socketId) {
        return store.getConnection(socketId);
      },

      async getUserConnections(userId) {
        const connectionIds = await store.getUserConnectionIds(userId);
        const connections = [];
        for (const socketId of connectionIds) {
          const conn = await store.getConnection(socketId);
          if (conn) connections.push(conn);
        }
        return connections;
      },

      async getOnlineCount() {
        return store.getOnlineCount();
      },

      async broadcastOnlineStatus(clientInfo, isOnline) {
        const eventType = isOnline ? 'userOnline' : 'userOffline';

        if (clientInfo.isGuest) {
          await services.conversation.broadcastToConversation(clientInfo.conversationId, eventType, { userId: clientInfo.userId, name: clientInfo.nickname, avatar: clientInfo.avatar, isGuest: true }, { excludeClientId: clientInfo.userId });
          return;
        }

        const participantInfo = await services.conversation.getParticipantInfo(clientInfo.userId);
        const convIds = await services.conversation.getConversationIdsByUser(clientInfo.userId);
        const notifiedClients = new Set();

        await Promise.all(
          convIds.map(async convId => {
            const members = await services.conversation.getMemberIds(convId);
            await Promise.all(
              members.map(async member => {
                const clientId = services.conversation.getMemberClientId(member);
                if (clientId !== clientInfo.userId && !notifiedClients.has(clientId)) {
                  notifiedClients.add(clientId);
                  await services.ws.sendToUser(clientId, eventType, {
                    userId: clientInfo.userId,
                    ...participantInfo
                  });
                }
              })
            );
          })
        );
      },

      // ── 业务处理 ──

      async handleGetUserInfo(clientInfo) {
        const participantInfo = clientInfo.isGuest ? { name: clientInfo.nickname, avatar: clientInfo.avatar, isGuest: true } : await services.conversation.getParticipantInfo(clientInfo.userId, clientInfo.conversationId);
        await services.ws.sendToUser(clientInfo.userId, 'getUserInfo', { ...clientInfo, ...participantInfo });
      },

      async handleGetConversations(clientInfo, payload) {
        if (clientInfo.isGuest) {
          const conv = await services.conversation.getConversationDetail(clientInfo.conversationId, clientInfo.memberId);
          await services.ws.sendToUser(clientInfo.userId, 'conversations', { list: conv ? [conv] : [] });
        } else {
          const conversations = await services.conversation.getConversations(clientInfo.userId, payload?.page, payload?.pageSize);
          await services.ws.sendToUser(clientInfo.userId, 'conversations', { list: conversations });
        }
      },

      async handleSendMessage(clientInfo, payload = {}, traceId) {
        const conversationId = payload.conversationId || clientInfo.conversationId;
        if (!payload.clientMsgId) {
          await services.ws.sendToUser(clientInfo.userId, 'error', { message: 'clientMsgId required' });
          return;
        }
        if (clientInfo.isGuest && conversationId !== clientInfo.conversationId) {
          await services.ws.sendToUser(clientInfo.userId, 'error', {
            message: 'Guest can only send messages in assigned conversation'
          });
          return;
        }

        let senderMemberId = clientInfo.memberId;
        if (!senderMemberId) {
          const member = await services.conversation.getMemberByUserAndConversation(clientInfo.userId, conversationId);
          if (!member) {
            await services.ws.sendToUser(clientInfo.userId, 'error', {
              message: 'Not a member of this conversation'
            });
            return;
          }
          senderMemberId = member.id;
        }

        const resolvedTraceId = traceId || payload.traceId || crypto.randomUUID();
        if (Number(payload.retry) > 0) await services.metrics?.record('im:send_retry');
        const started = Date.now();
        try {
          await services.message.sendMessage({
            conversationId,
            senderMemberId,
            content: payload.content,
            type: payload.type,
            clientMsgId: payload.clientMsgId,
            traceId: resolvedTraceId,
            onPersisted: async message => {
              const sentAt = Number(payload.sentAt);
              services.metrics?.observeSendAck(Number.isFinite(sentAt) ? Date.now() - sentAt : Date.now() - started);
              fastify.log?.info(
                {
                  traceId: resolvedTraceId,
                  userId: clientInfo.userId,
                  conversationId,
                  clientMsgId: payload.clientMsgId,
                  seq: message.seq,
                  instanceId: options.instanceId
                },
                'message persisted'
              );
              await services.ws.sendToUser(clientInfo.userId, 'sendAck', {
                messageId: message.id,
                seq: message.seq,
                clientMsgId: message.clientMsgId,
                traceId: resolvedTraceId,
                conversationId
              });
            }
          });
        } catch (error) {
          fastify.log?.error({ err: error, traceId: resolvedTraceId, userId: clientInfo.userId, conversationId, clientMsgId: payload.clientMsgId, instanceId: options.instanceId }, 'send message failed');
          await services.ws.sendToUser(clientInfo.userId, 'error', { message: clientMessage(error) });
        }
      },

      async handleRecvAck(clientInfo, payload = {}) {
        try {
          const conversationId = payload.conversationId || clientInfo.conversationId;
          const memberId = await services.conversation.resolveMemberId(clientInfo, conversationId);
          if (!memberId) throw new Error('Not a member of this conversation');
          await services.message.recvAck({ messageId: payload.messageId, memberId });
        } catch (error) {
          fastify.log?.warn({ err: error, userId: clientInfo.userId, messageId: payload.messageId }, 'recvAck failed');
          await services.ws.sendToUser(clientInfo.userId, 'error', { message: clientMessage(error) });
        }
      },

      async handleReadMessages(clientInfo, payload = {}) {
        const conversationId = payload.conversationId || clientInfo.conversationId;
        if (clientInfo.isGuest && conversationId !== clientInfo.conversationId) return;

        const memberId = await services.conversation.resolveMemberId(clientInfo, conversationId);
        if (!memberId) return;

        try {
          await services.message.readMessages(conversationId, memberId, payload.lastMessageId, payload.lastSeq);
        } catch (error) {
          fastify.log?.warn({ err: error, userId: clientInfo.userId, conversationId }, 'readAck failed');
          await services.ws.sendToUser(clientInfo.userId, 'error', { message: clientMessage(error) });
        }
      },

      async handleRevokeMessage(clientInfo, payload) {
        try {
          await services.message.revokeMessage(payload.messageId, {
            memberId: clientInfo.memberId,
            userId: clientInfo.isGuest ? null : clientInfo.userId
          });
        } catch (error) {
          await services.ws.sendToUser(clientInfo.userId, 'error', { message: clientMessage(error) });
        }
      },

      async handleGetMessageHistory(clientInfo, payload) {
        const conversationId = payload.conversationId || clientInfo.conversationId;
        if (clientInfo.isGuest && conversationId !== clientInfo.conversationId) return;

        const memberId = await services.conversation.resolveMemberId(clientInfo, conversationId);
        if (!memberId) return;

        const messages = await services.message.getMessageHistory(conversationId, memberId, payload.beforeId, payload.limit);
        await services.ws.sendToUser(clientInfo.userId, 'messageHistory', {
          conversationId,
          list: messages
        });
      },

      async handleGetUnreadCount(clientInfo) {
        if (clientInfo.isGuest) {
          const unreadCounts = await services.message.getUnreadCountByConversation(clientInfo.conversationId);
          const unreadCount = unreadCounts[clientInfo.memberId] || 0;
          await services.ws.sendToUser(clientInfo.userId, 'unreadCount', {
            conversations: { [clientInfo.conversationId]: unreadCount },
            system: 0
          });
        } else {
          const conversations = await services.message.getUnreadCountByConversations(clientInfo.userId);
          const system = await services.systemMessage.getUnreadSystemMessageCount(clientInfo.userId);
          await services.ws.sendToUser(clientInfo.userId, 'unreadCount', { conversations, system });
        }
      },

      async handleTyping(clientInfo, payload, type) {
        const conversationId = payload.conversationId || clientInfo.conversationId;
        if (clientInfo.isGuest && conversationId !== clientInfo.conversationId) return;

        const participantInfo = clientInfo.isGuest ? { name: clientInfo.nickname, avatar: clientInfo.avatar, isGuest: true } : await services.conversation.getParticipantInfo(clientInfo.userId, conversationId);

        await services.conversation.broadcastToConversation(
          conversationId,
          type,
          {
            conversationId,
            userId: clientInfo.userId,
            ...participantInfo
          },
          { excludeClientId: clientInfo.userId }
        );
      },

      async handleGetOnlineUsers(clientInfo, payload) {
        const conversationId = payload.conversationId || clientInfo.conversationId;
        if (clientInfo.isGuest && conversationId !== clientInfo.conversationId) return;

        const members = await services.conversation.getMembers(conversationId);
        const onlineUsers = [];
        await Promise.all(
          members.map(async member => {
            const isOnline = await services.ws.isOnline(member.clientId);
            if (isOnline) {
              onlineUsers.push({
                userId: member.clientId,
                name: member.name,
                avatar: member.avatar,
                isGuest: member.isGuest
              });
            }
          })
        );

        await services.ws.sendToUser(clientInfo.userId, 'onlineUsers', {
          conversationId,
          users: onlineUsers
        });
      },

      async pushUnreadSystemCount(userId) {
        try {
          const systemUnread = await services.systemMessage.getUnreadSystemMessageCount(userId);
          await services.ws.sendToUser(userId, 'unreadSystemCount', { count: systemUnread });
        } catch (error) {
          fastify.log?.warn({ err: error, userId }, 'push unread system count failed');
        }
      },

      async closeAll() {
        const connections = await store.getAllConnections();
        for (const connection of connections) {
          if (connection.heartbeatTimer) {
            clearInterval(connection.heartbeatTimer);
          }
        }
      }
    }
  });

  fastify.addHook('onClose', async () => {
    await services.ws.closeAll();
  });
});

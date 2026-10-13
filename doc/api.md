### 插件选项

| 属性名 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| prefix | HTTP 与 WebSocket 路由前缀 | string | - |
| name | 命名空间 | string | `im` |
| dbTableNamePrefix | 表名前缀 | string | `t_` |
| heartbeatInterval | 心跳间隔，超时关闭码 4004 | number | `30000` |
| instanceId | 进程指标的 instance 标签 | string | `hostname:pid` |
| backlogWarn | 离线通知或未确认消息达到该值时打警告日志 | number | `1000` |
| verifyToken | 校验系统用户 token，抛错时连接以 4003 关闭 | function | - |
| getAuthenticate | HTTP 接口鉴权 | function | 账号插件的用户鉴权 |
| sendOfflineMessages | 用户不在本进程时的离线通知回调 | function | - |
| statistics | 传给 `@kne/fastify-statistics` 的额外选项。宿主已注册统计插件时复用，不再注册 | object | - |

未注册统计插件时，本插件会注册 `fastify-cron`（若尚未注册）和 `@kne/fastify-statistics`。统计路由前缀为 `{prefix}/statistics`，启动补偿和每日清理默认关闭。

### WebSocket

地址：`GET {prefix}/ws`。

令牌放在 `sec-websocket-protocol`，也接受查询参数 `token`。没有令牌时关闭码 `4001`，鉴权失败为 `4003`，心跳超时为 `4004`。

#### 发送

```json
{ "type": "sendMessage", "traceId": "t1", "payload": { "clientMsgId": "c1", "conversationId": "1", "type": "text", "content": { "type": "text", "value": "hi" }, "sentAt": 1710000000000 } }
```

`clientMsgId` 必填。同一会话、同一发送者的重复 `clientMsgId` 只落一条消息，并再次返回原来的 `sendAck`。

#### sendAck

落库成功后发给发送方：

```json
{ "type": "sendAck", "payload": { "messageId": "1", "seq": 1, "clientMsgId": "c1", "traceId": "t1", "conversationId": "1" } }
```

`seq` 在会话内单调递增。服务内部调用可以不传 `clientMsgId`，这种写入不会按客户端消息号去重。

#### recvAck

接收方确认本连接已收到。不补发，丢失只影响接收回执计数。

```json
{ "type": "recvAck", "payload": { "messageId": "1", "conversationId": "1" } }
```

#### readAck

`readAck` 与已有的 `readMessages` 相同。已读序号只向前移动，且消息必须属于该会话。

```json
{ "type": "readAck", "payload": { "conversationId": "1", "lastMessageId": "1", "lastSeq": 1 } }
```

### 指标

`GET {prefix}/metrics` 返回 Prometheus 文本，由 `@kne/fastify-statistics` 生成。

进程计数使用 `inc` / `set` / `observe`。消息条数、重复发送、接收回执和重试还会通过 `collect` 写入通道 `im`，供按时间窗口查询。

### 客户端重试

`libs/client/reliable-send.js` 导出 `ReliableSender`。未收到 `sendAck` 时从 1 秒起指数退避，封顶 30 秒，最多 5 次，重发使用同一个 `clientMsgId`。`missingSeqs` 按 `seq` 找出缺口。

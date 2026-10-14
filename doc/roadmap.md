# @kne/fastify-im 演进方向

对照 [Rocket.Chat](https://docs.rocket.chat/docs/rocketchat) 的产品分层与成熟度模型，为本包规划演进路径。  
**定位**：可嵌入 Fastify 宿主的 IM **后端能力插件**，不是 Rocket.Chat 式全量协作产品（无自带 Workspace UI / Marketplace / 完整客户端）。

参考来源：

- Rocket.Chat 能力面：Team collaboration、Omnichannel、Voice、Federation、Extensibility
- 架构组件：WS 实时层、RBAC、Push、File storage、Apps-Engine、Integrations
- 成熟度：Alpha → Beta → GA（见 [Product readiness](https://docs.rocket.chat/docs/product-readiness)）

---

## 1. 当前基线（v0.2.x ≈ Rocket.Chat「消息内核」子集）

| 能力域 | 现状 | 成熟度 |
| --- | --- | --- |
| 单聊 / 群聊模型 | 会话、成员、消息、已读、撤回 | 可用 |
| 可靠发送 | `clientMsgId` 幂等、`seq`、`sendAck`、客户端 `ReliableSender` | 可用 |
| 回执 | `recvAck`（不补发）、`readAck` | 部分 |
| Guest / 访客 | shorten token + guest 成员 | 部分（缺 HTTP 签发） |
| 系统消息 | 收件箱 + 已读 | 部分（缺对外 push API） |
| 在线态 | 进程内多连接；可注入 `connectionStore` | 部分 |
| 离线通知 | `sendOfflineMessages` 钩子 + notification 表 | 部分 |
| 群角色 | owner/admin/member/guest 字段 | 存根（未做 ACL） |
| 媒体 | `img/audio/file` 枚举 | 存根（无上传管线） |
| 指标 | `/metrics` + statistics 通道 | 可用 |

已有优势应**继续加深**，而不是重写：幂等发送、会话 `seq`、WS 协议、可注入鉴权与离线钩子。

---

## 2. 演进原则（对标 Rocket.Chat，但不复制形态）

1. **做内核，不做产品壳**  
   Rocket.Chat 的 Channels / Teams / Omnichannel / Marketplace 在本包中应落成 **模型 + API + 钩子**，由宿主应用决定 UI 与业务流程。

2. **先可靠与权限，再协作增强，再扩展面**  
   对应 Rocket.Chat 演进顺序：实时消息可靠 → RBAC/房间治理 → 文件与搜索 → Omnichannel/Integrations →（可选）Federation。

3. **可插拔适配器优先于内置实现**  
   对齐 RC 的 File storage、Push gateway、Apps-Engine：本包提供接口与默认实现，媒体/推送/集群用 adapter 交给宿主。

4. **成熟度门禁**  
   每个关键节点用 Alpha（接口可用）→ Beta（测试与文档齐）→ GA（多实例与回归覆盖）推进，避免「半成品永久化」。

5. **明确不做 / 后置**  
   自建 Matrix Federation、完整语音 SFU、官方 Marketplace、桌面/移动客户端——不在本包主线；最多预留 signaling / webhook 扩展点。

---

## 3. Rocket.Chat 能力映射

| Rocket.Chat | 对本包的含义 | 建议落点 |
| --- | --- | --- |
| DMs + Channels + Teams | 会话类型扩展（private / public channel / team 容器） | Phase 2–3 |
| Threads / Discussions | `parentMessageId` 线程与讨论会话 | Phase 2 |
| File sharing | 上传策略 + 存储 adapter + 消息附件 | Phase 2 |
| Search | 消息全文 / 过滤器索引 | Phase 3 |
| Livechat / Omnichannel | 强化 guest、路由、座席分配钩子 | Phase 3 |
| Roles & Permissions | 落实群/频道 RBAC | Phase 1 |
| Push notifications | 离线推送 gateway 抽象 | Phase 1–2 |
| Webhooks / Integrations | 出站事件 + 入站 slash/命令钩子 | Phase 3 |
| Apps-Engine | `onBeforeSend` / `onMessage` 中间件链 | Phase 3 |
| Voice / Conference | 通话房间 signaling 钩子（外接 Jitsi 等） | Phase 4（可选） |
| Matrix Federation | 跨实例协议 | 非目标 / 远期研究 |
| E2E / Audit / Retention | 加密钩子、审计日志、保留策略 | Phase 3–4 |

---

## 4. 关键功能节点（里程碑）

版本号为建议目标，可按宿主需求合并或拆分发布。

### Phase 0 — 基线固化（当前 → 0.2.x GA）

**目标**：把已有内核打磨到可承诺的稳定契约。

| 节点 | 交付物 | 验收 |
| --- | --- | --- |
| P0.1 协议文档化 | OpenAPI/WS 消息类型目录、关闭码表 | 与 README 一致，含示例 |
| P0.2 导出面整理 | `ReliableSender` 从包入口可引用 | 文档 + 单测 |
| P0.3 缺口清理 | 启用或删除无用的 `offlineNotifyInterval`；补齐 guest-access HTTP 或删注释 | 无「死配置」 |
| P0.4 测试加深 | 关键路径补 WS 级集成测 | CI 跑通 mocha |

### Phase 1 — 权限与投递闭环（→ 0.3）

对应 Rocket.Chat：**RBAC + Push + 实时可靠性**。

| 节点 | 交付物 | 为什么关键 |
| --- | --- | --- |
| **P1.1 群/会话 ACL** | owner/admin 才可管理成员与会话元数据；可配置权限表 | 角色字段当前未强制，是群聊生产化阻塞点 |
| **P1.2 重连补齐** | 基于 `lastSeq` / `missingSeqs` 的服务端 gap 查询（`sync` / `fetchMissing`） | RC 体验依赖断线后状态一致；现仅客户端猜缺口 |
| **P1.3 离线通知闭环** | 通知聚合、节流（真正使用 interval）、失败重试指标 | 对齐 RC Push；宿主仍实现实际推送通道 |
| **P1.4 Redis `connectionStore` 参考实现** | 多实例在线态与 fan-out 文档 | 单机 Memory 无法支撑生产水平扩展 |
| **P1.5 系统消息 HTTP 管理面** | 管理员/服务账号 push + 按角色广播契约 | 补齐「服务端主动触达」 |

**Phase 1 完成标志**：双实例部署下，发消息、重连补齐、权限拒绝、离线钩子均可验证。

### Phase 2 — 协作增强（→ 0.4）

对应 Rocket.Chat：**Threads、File sharing、Channels 雏形**。

| 节点 | 交付物 | 为什么关键 |
| --- | --- | --- |
| **P2.1 消息编辑 + @提及** | edit 事件、mention 解析与未读扩展 | 团队协作最小增量 |
| **P2.2 线程** | `threadId` / `parentMessageId`，线程内独立 seq 或子序号 | RC Discussions/Threads 的内核等价物 |
| **P2.3 媒体管线** | `storage` adapter（本地/S3）、附件元数据、类型白名单 | 消息类型枚举否则永远是空壳 |
| **P2.4 频道模型** | `conversation.type` 增加 `channel`（公开/私有可见性） | 从「私聊会话」走向「工作区房间」 |
| **P2.5 消息搜索（基础）** | 按会话关键词 / 时间窗查询（可先 DB LIKE，后接外部索引） | RC Search 的入口能力 |

**Phase 2 完成标志**：宿主可搭出「频道 + 附件 + 线程回复」而不改插件源码。

### Phase 3 — 业务扩展面（→ 0.5）

对应 Rocket.Chat：**Omnichannel + Integrations + Apps-Engine 思路**。

| 节点 | 交付物 | 为什么关键 |
| --- | --- | --- |
| **P3.1 Omnichannel 钩子** | visitor 会话、部门/队列、座席认领/转接服务接口 | Guest 升级为客服场景；逻辑在宿主，模型在插件 |
| **P3.2 出站 Webhook** | `message.created` / `member.joined` 等事件订阅 | 对齐 RC Integrations |
| **P3.3 入站命令 / Bot** | slash command 或 `bot` 发送者角色 + 中间件 | 对齐 Apps 轻量版 |
| **P3.4 审计与保留** | 操作审计表、消息 TTL/归档策略钩子 | 企业合规常见硬需求 |
| **P3.5 加密扩展点** | E2E 密文透传约定（服务端不解密） | 对齐 RC E2E，但不自研密码学协议 |

**Phase 3 完成标志**：宿主可用 webhook + guest 路由搭出简易客服台，且有审计轨迹。

### Phase 4 — 可选增强（→ 0.6+，按需）

| 节点 | 交付物 | 说明 |
| --- | --- | --- |
| P4.1 通话 signaling | 房间级 offer/answer 事件，外接 SFU/Jitsi | 不做媒体面 |
| P4.2 多租户 / Workspace | `workspaceId` 隔离 | 仅当宿主多租户强需求时做 |
| P4.3 Federation 研究 | 评估 Matrix 桥或自定义联邦 | **默认非目标** |
| P4.4 管理只读 API | 会话/连接/积压运维面 | 服务 `/status` `/metrics` |

---

## 5. 建议优先级排序（最近两个版本）

若资源有限，**0.3 只做这五件事**：

1. 群 ACL（P1.1）  
2. 重连 `sync`（P1.2）  
3. Redis connectionStore 示例（P1.4）  
4. Guest-access HTTP（P0.3）  
5. 离线通知节流与指标（P1.3）  

**0.4 再开**：媒体 adapter（P2.3）→ 线程（P2.2）→ channel 类型（P2.4）。

Omnichannel / Webhook 放到有明确宿主业务（客服、工单）再启动，避免过早抽象。

---

## 6. 非目标清单

| 不做 | 原因 |
| --- | --- |
| 内置 Web/桌面/移动客户端 | 包定位是 Fastify 插件 |
| 官方 App Marketplace | 应由 kne 生态或宿主扩展体系承担 |
| 自研完整 RTC / SFU | 成本与运维面过大 |
| 默认绑定 Mongo/Matrix | 现有 Sequelize 栈；联邦另案评估 |
| 复制 Rocket.Chat 全部房间概念一次到位 | 分阶段扩展 `conversation.type`，保持迁移可控 |

---

## 7. 与版本发布的对应关系（示意）

```text
0.2.x  消息内核 GA（幂等 / seq / ack / 基础群聊）
0.3.x  权限 + 多实例投递 + 重连同步
0.4.x  线程 / 媒体 / 频道 / 搜索入口
0.5.x  Omnichannel 钩子 / Webhook / 审计
0.6+   通话 signaling、多租户、（可选）联邦研究
```

每条主版本应附带：迁移说明、WS 协议变更表、至少一条「双实例」或「权限拒绝」回归用例。

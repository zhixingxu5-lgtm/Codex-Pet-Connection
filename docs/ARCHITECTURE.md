# 架构说明

## 数据流

```text
Codex App Server ─┐
                  ├─ 本地状态聚合器 ─ 桌宠窗口 ─ WebSocket ─ 同步服务 ─ 好友桌宠
Codex Plugin Hook ┘              │
                                 └─ SQLite 当日工作量
```

App Server 使用 `codex app-server proxy`，每 3 秒调用 `thread/loaded/list` 和只读 `thread/read`，不执行 `thread/resume`，避免改变现有桌面会话。App Server 最近 5 秒内有事件时，同一会话的 Hook 事件被忽略。

Hook 只保留 `session_id`、`turn_id`、`hook_event_name` 和本地发生时间。Node 与 Rust sidecar 都有隐私过滤测试。Hook 与桌面进程通过用户级 IPC 通信：macOS 使用应用数据目录内的 Unix domain socket，Windows 使用 `\\.\pipe\codex-pet-link` named pipe；消息还必须携带应用启动时生成的随机 secret，macOS secret 权限设为 `0600`。

## 状态与计时

会话优先级为 `needs_input > blocked > ready > running > idle`。并行任务只在聚合状态为 `running` 时累计一次墙钟时间。等待审批不累计；本地午夜删除前一日记录并归零。

- 0–20 分钟：`relaxed`
- 20–60 分钟：`focused`
- 60–120 分钟：`tired`
- 120 分钟以上：`exhausted`

`ready` 30 秒后失效，`blocked` 5 分钟后失效。关闭精力共享后发出 `energyState: null`；隐私暂停只发 `presence: privacy_hidden`。

## 安全边界

设备令牌为 32 随机字节，服务端只保存 SHA-256；客户端令牌放入系统凭据存储。同步 Schema 使用 Zod strict 模式拒绝额外字段。配对关系一对一，解除后删除双方快照并推送 `pair.revoked`。

MVP 后端按单实例部署设计，连接表保存在内存；PostgreSQL 保存设备、配对和最新状态。需要水平扩展时再引入 Redis/NATS 广播，不在 MVP 内。

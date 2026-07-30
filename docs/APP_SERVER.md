# Codex App Server 只读契约

桌面适配器通过 `codex app-server proxy` 连接正在运行的 daemon。当前契约已用本机
`codex app-server generate-json-schema --experimental` 生成的官方 schema 核对。

允许发出的请求只有：

- `initialize` / `initialized`；
- `thread/loaded/list`；
- `thread/read`，且只读取已经加载的线程。

消费的事件包括 `turn/started`、`turn/completed`、四类审批/用户输入请求及
`serverRequest/resolved`。适配器不会调用 `thread/start`、`turn/start`、`turn/steer`、
中断、审批响应或任何写入方法。

Rust 契约测试覆盖完成、失败、中断、审批、审批解除、等待审批的已加载线程、未知事件和
未知字段。若 proxy 不存在、daemon 未运行或任一平台 PoC 失败，通道关闭并保留 Hooks 降级。

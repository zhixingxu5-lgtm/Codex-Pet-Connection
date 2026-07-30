# 自托管同步服务

本地测试使用根目录 `docker-compose.yml`；腾讯云生产部署使用
[`deploy/tencent-cloud`](../deploy/tencent-cloud/README.md)。

## 本地启动

```bash
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
```

源码运行桌面端时设置：

```bash
PETLINK_SERVER_URL=http://127.0.0.1:8787 pnpm dev:desktop
```

## 自定义发行包

`PETLINK_SERVER_URL` 会在 Rust 编译阶段嵌入应用；必须使用不带尾部斜杠的 HTTP(S) 根地址。
生产发行必须是 `https://`，WebSocket 地址会自动转换成 `wss://`。

```bash
PETLINK_SERVER_URL=https://sync.example.com \
  pnpm --filter @petlink/desktop tauri build
```

服务端只保留当前快照，不保存 Prompt、代码或工作量历史。PostgreSQL 应位于私有 Docker
网络，不得直接暴露到公网。

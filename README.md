# Codex Pet Link

双人互联 Codex 桌宠 MVP。macOS 和 Windows 桌面会同时显示自己的 Pingu 与一位好友的
Pingu，并同步隐私过滤后的 Codex 任务状态与当天精力状态。

> 当前为预览版：代码和自托管服务已经齐备，但公共腾讯云地址尚未配置。正式“下载安装即可
> 配对”的稳定版会在 `PETLINK_SERVER_URL` 配置为 HTTPS 地址后发布。

## MVP 功能

- 一名用户与一名好友，通过八位配对码连接；
- 两个可独立拖动、缩放、隐藏、置顶的透明桌宠窗口；
- `idle / running / needs_input / ready / blocked / offline`；
- `relaxed / focused / tired / exhausted` 四档当天精力；
- Codex App Server 精确检测与 Hooks 降级；
- WebSocket 实时同步、断线重连、隐私暂停、精力隐藏和解除配对；
- SQLite 当日计时、Keychain/Windows Credential Manager 设备令牌；
- 系统与应用级减少动态；
- CSS Pingu 回退形象及十二条 WebP 动画槽位。

应用不会读取或上传 Prompt、回复、代码、项目名、文件路径、工具参数或命令输出。

## 快速开始（开发者）

要求 Node.js 22、pnpm 11、Rust stable、Docker，以及对应平台的 Tauri 构建依赖。

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres sync-server
PETLINK_SERVER_URL=http://127.0.0.1:8787 pnpm dev:desktop
```

验证仓库：

```bash
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace
cargo check --workspace
docker build -f services/sync-server/Dockerfile .
```

## 文档

- [安装与 Hook 信任](docs/INSTALLATION.md)
- [自托管同步服务](docs/SELF_HOSTING.md)
- [架构](docs/ARCHITECTURE.md)
- [App Server 只读契约](docs/APP_SERVER.md)
- [隐私](docs/PRIVACY.md)
- [安全策略](SECURITY.md)
- [测试与验收](docs/TESTING.md)
- [双平台人工验收表](docs/MANUAL_QA.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [发布流程](docs/RELEASE.md)
- [贡献指南](CONTRIBUTING.md)

## 暂不包含

多人、多设备、主动互动、聊天、道具、局域网同步、历史报表、账户找回、商店发布和正式
代码签名不属于 v0.1.0 MVP。

## License

源码与仓库内 Pingu 素材均采用 [MIT License](LICENSE)。

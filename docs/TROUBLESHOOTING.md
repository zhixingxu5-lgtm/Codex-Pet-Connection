# 故障排查

## 显示“有限检测”

确认 `codex app-server proxy` 可以连接当前 Codex daemon；无法连接时属于预期降级。检查桌面
应用正在运行，重新安装插件，并在 Codex `/hooks` 中确认 Hook 已信任。

## Hook 没有更新状态

- macOS 检查应用数据目录下 `hook-secret` 与 `hook.sock`；
- Windows 检查 named pipe `\\.\pipe\codex-pet-link`；
- 不要手动复制其他设备的 secret；重启桌面应用会生成新 secret；
- Hook 超时只影响桌宠，不影响 Codex 工作。

## 无法配对或好友离线

检查服务 `/healthz`、系统时间和 HTTPS 证书。配对码十分钟失效，十分钟内第六次错误认领会
被限流。好友六十秒没有状态心跳后显示离线，恢复网络后客户端会自动重连。

## 素材没有生效

默认使用 CSS Pingu。只有十二条 WebP 均按 manifest 放置，并在构建时设置
`VITE_USE_SPRITES=true`，才启用精灵条带。

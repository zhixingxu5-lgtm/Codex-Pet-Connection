# 发布流程

## 预览包

在 Actions 手动运行 `Package preview builds`。工作流生成未签名的 macOS DMG、Windows
MSI/EXE 和 SHA-256 校验文件，但不会创建稳定 Release。

若本地网络无法访问 crates.io，可在首次推送后手动运行 `Generate Cargo lockfile`，下载
artifact 中的 `Cargo.lock`，提交后再发布稳定版。稳定版工作流使用 `--locked`，缺少或过期
的锁文件会直接失败。

## 稳定版

1. 部署腾讯云服务并确认 `https://<domain>/healthz`。
2. 在 GitHub Variables 设置 `PETLINK_SERVER_URL=https://<domain>`。
3. 在干净 macOS、Windows 设备完成安装、插件信任和双机配对验收。
4. 更新版本号与变更日志，提交后创建 `v*` tag。
5. `Release` 工作流拒绝空地址或非 HTTPS 地址，构建两平台包、生成校验值并创建 Release。

正式商业发布前还必须配置 Apple Developer ID、公证、Windows Authenticode 和安全审计。

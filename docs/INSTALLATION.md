# 安装与 Codex 接入

## 普通用户

1. 从 GitHub Releases 下载当前平台的 DMG、MSI 或 EXE，并核对 `SHA256SUMS.txt`。
2. 未签名预览版在 macOS 需要前往“系统设置 → 隐私与安全”确认打开；Windows 需要在
   SmartScreen 中选择“更多信息 → 仍要运行”。
3. 启动 Codex Pet Link，桌面应出现“我的 Pingu”和“好友 Pingu”。
4. 在设置页点击“安装本地插件”。
5. 打开 Codex，输入 `/hooks`，审阅并信任 `Codex Pet Link` Hook。
6. 一台设备生成配对码，另一台在十分钟内认领。

## 检测模式

- App Server 可连接时会识别开始、审批、成功、失败和中断。
- App Server 不可连接时自动使用 Hook，并显示“有限检测”。Hook 的 `Stop` 无法判断最终
  成败，因此按完成处理；失败可在模拟/诊断区域手动切换为 `blocked`。
- Hook 失败不会阻断 Codex 任务。

## 卸载

先在设置页解除配对，再点击“卸载插件”。随后退出应用并使用系统卸载方式移除桌面端。
解除配对会立即撤销好友状态访问并删除服务端双方快照；本地 SQLite 可随应用数据目录一并
删除。

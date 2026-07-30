# 腾讯云部署

适用于已解析到腾讯云轻量应用服务器公网 IP 的域名。服务器只开放 TCP 22、80、443 和
UDP 443；不要开放 PostgreSQL 的 5432 端口。

```bash
cp deploy/tencent-cloud/.env.example deploy/tencent-cloud/.env
# 编辑域名、ACME 邮箱和 URL-safe 随机数据库密码（只使用字母、数字、-、_）
docker compose --env-file deploy/tencent-cloud/.env \
  -f deploy/tencent-cloud/docker-compose.prod.yml up -d --build
curl https://sync.example.com/healthz
```

Caddy 自动签发并续期证书，WebSocket 会通过同一 HTTPS 域名升级。生产数据保存在命名卷
`postgres-data` 中。升级前使用 `pg_dump` 备份，升级后检查三个容器的健康状态。

正式发行前，将完整地址（例如 `https://sync.example.com`）写入 GitHub 仓库 Variable
`PETLINK_SERVER_URL`。不要把 `.env`、数据库密码、SSH 密钥或域名服务商令牌提交到 Git。

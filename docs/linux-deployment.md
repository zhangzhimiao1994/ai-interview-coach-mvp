# Linux 服务器部署说明

这个项目支持三种 Linux 部署方式：

1. Docker Compose，优先推荐。
2. 部署包方式，适合你把本机生成的 `.tar.gz` 上传到服务器。
3. 原生 Node.js 方式，适合服务器已经装好 Node.js 和进程管理器。

默认监听端口是 `3000`。Docker 容器内数据库路径是 `/app/data/prod.db`，原生 Linux 路径是 `data/prod.db`。

## 部署包方式

我生成的部署包会放在本机 `outputs/` 目录，例如：

```text
outputs/ai-interview-coach-linux-YYYYMMDD-HHMMSS.tar.gz
```

注意：`.env 不在部署包内`，本地数据库、`.git`、`node_modules`、`.next`、测试报告也不会打进去，避免把密钥和临时文件带到服务器。

上传到服务器后执行：

```bash
mkdir -p /opt/ai-interview-coach-mvp
tar -xzf ai-interview-coach-linux-YYYYMMDD-HHMMSS.tar.gz -C /opt/ai-interview-coach-mvp
cd /opt/ai-interview-coach-mvp
cp .env.example .env
```

必须修改 `.env`：

```env
DATABASE_URL="file:./data/prod.db"
PORT=3000
RUN_DB_SEED=false
AI_PROVIDER=database
AI_CONFIG_SECRET="replace-with-a-long-random-secret"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="replace-with-a-strong-password"
```

`AI_CONFIG_SECRET` 不能使用 `change-this-before-production`。它用于加密后台保存的服务商 API Key。

然后执行：

```bash
chmod +x scripts/linux/*.sh
scripts/linux/setup.sh
scripts/linux/start.sh
```

访问：

```text
http://服务器IP:3000
```

如果要换端口，例如 `8080`，修改 `.env`：

```env
PORT=8080
```

然后重启服务。

## Docker Compose 部署

服务器需要安装 Docker 和 Docker Compose。

准备环境变量：

```bash
cp .env.example .env
```

Docker 推荐 `.env`：

```env
DATABASE_URL="file:/app/data/prod.db"
PORT=3000
RUN_DB_SEED=false
AI_PROVIDER=database
AI_CONFIG_SECRET="replace-with-a-long-random-secret"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="replace-with-a-strong-password"
```

启动：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f interview-coach
```

停止：

```bash
docker compose down
```

Docker 改端口：

```env
PORT=8080
```

然后执行：

```bash
docker compose up -d
```

此时访问：

```text
http://服务器IP:8080
```

## 原生 Node.js 部署

服务器要求：

- Linux
- Node.js 22 LTS
- npm
- Git 或部署包

首次安装：

```bash
chmod +x scripts/linux/*.sh
scripts/linux/setup.sh
```

直接启动：

```bash
scripts/linux/start.sh
```

PM2 启动：

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

systemd 启动：

```bash
sudo cp scripts/linux/ai-interview-coach.service /etc/systemd/system/ai-interview-coach.service
sudo systemctl daemon-reload
sudo systemctl enable ai-interview-coach
sudo systemctl start ai-interview-coach
```

查看状态：

```bash
sudo systemctl status ai-interview-coach
journalctl -u ai-interview-coach -f
```

## Nginx 反向代理

示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

公开给候选人使用前，需要配置 HTTPS。否则浏览器可能限制摄像头和麦克风权限。

## 更新服务

Docker：

```bash
git pull
docker compose up -d --build
```

原生 Linux：

```bash
git pull
scripts/linux/setup.sh
pm2 restart ai-interview-coach
```

systemd：

```bash
git pull
scripts/linux/setup.sh
sudo systemctl restart ai-interview-coach
```

数据库结构更新使用 Prisma migration：

```bash
npm run db:migrate:deploy
```

## 备份 SQLite 数据

Docker：

```bash
docker compose exec interview-coach sh -c 'mkdir -p /app/data/backups && cp /app/data/prod.db /app/data/backups/prod-$(date +%Y%m%d-%H%M%S).db'
```

原生 Linux：

```bash
mkdir -p data/backups
cp data/prod.db data/backups/prod-$(date +%Y%m%d-%H%M%S).db
```

## 回滚

查看版本：

```bash
git log --oneline
```

回到某个版本：

```bash
git checkout <commit-id>
```

然后重新构建或重启。数据库结构如果已经升级，回滚代码前先恢复数据库备份。

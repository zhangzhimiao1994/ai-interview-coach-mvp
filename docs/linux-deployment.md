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
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

应用的自定义 Node 入口在同一个端口处理 Next.js HTTP 请求和 `/ws/asr` WebSocket upgrade，不需要开放额外的中继端口。上面的 `Upgrade` 和 `Connection` 头必须保留，否则同源 WebSocket 会在 Nginx 处失败并触发浏览器识别降级。

公开给候选人使用前必须配置 HTTPS。否则浏览器可能限制摄像头、麦克风、AudioWorklet 和安全的 `wss://` 连接。生产页面、API 与 `/ws/asr` 必须使用同一域名；不要把阿里上游 WebSocket 地址或 API Key 暴露给浏览器。

### 生产环境配置阿里语音

阿里凭据不写入 `.env`。管理员通过 `AI 配置中心` 保存以下数据库配置，API Key 会使用 `AI_CONFIG_SECRET` 加密：

- 服务商公开设置：`region`、`workspaceId`；
- 加密凭据：通用 `apiKey`，以及可选的 `asrApiKey`、`ttsApiKey`；
- ASR 参考模型：`qwen3-asr-flash-realtime`；
- TTS 参考模型：`qwen3-tts-instruct-flash`。

推荐参考可以编辑，但不会自动参与调用。必须分别把一个 ASR 模型和一个 TTS 模型设为“当前使用（isSelected）”。更新配置后，新建 ASR 会话和新的语音合成请求会读取最新选择，正在进行的 WebSocket 不会中途切换模型。

候选人端显示“阿里实时识别优先 / 浏览器识别降级”，数字面试官显示“阿里真实语音优先 / 浏览器语音降级”。降级是显式运行状态，不会记录成阿里成功。

## 更新服务

Docker 镜像和源码版本必须来自同一个工作区、同一个分支。更新 Docker 服务时执行：

```bash
git switch feature/alibaba-multimodal-integration
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 interview-coach
```

`docker compose up -d --build` 会使用当前工作区重新构建诊断 API 和后台静态资源。SQLite 继续挂载在命名卷 `app-data` 中。不要执行 `docker compose down -v`，否则会删除数据库卷。

原生 Linux 使用 PM2 时执行：

```bash
git switch feature/alibaba-multimodal-integration
git pull
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build
pm2 restart ai-interview-coach
```

原生 Linux 使用 systemd 时执行相同的依赖、迁移和构建命令，然后重启服务：

```bash
git switch feature/alibaba-multimodal-integration
git pull
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build
sudo systemctl restart ai-interview-coach
```

生产数据库结构只使用 Prisma migration，不使用 `prisma db push`：

```bash
npm run db:migrate:deploy
```

### 更新后验证配置诊断

`/api/health` 仍然是无需认证的容器和数据库就绪检查。`/api/ai-services/diagnostics` 包含服务商与模型配置状态，受管理员 Basic Auth 保护，不能替代公开健康检查。

先把 `.env` 中的管理员账号加载到当前 shell，再读取无付费调用的配置摘要：

```bash
set -a
. ./.env
set +a
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" \
  "http://127.0.0.1:${PORT:-3000}/api/ai-services/diagnostics"
```

GET 摘要和后台首屏只检查本地配置。真实连通测试不会自动执行，只有管理员主动点击后台按钮或明确发送以下 POST 请求时，文本能力才会产生一个极低 token 的真实厂商调用：

```bash
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"capability":"INTERVIEW_DIALOGUE","liveCheck":true}' \
  "http://127.0.0.1:${PORT:-3000}/api/ai-services/diagnostics"
```

阿里 ASR/TTS 适配器已经落地，诊断会校验工作区、地域、专用或通用 API Key、当前模型和协议兼容性，但不会自动录音或合成付费音频。真实数字人视频和视觉行为分析仍只返回配置状态与“等待适配器”，不会把配置完整误报为真实服务可用。

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

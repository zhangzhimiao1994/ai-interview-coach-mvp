# Windows 本地调试与 Linux 部署

Windows、Linux 和 Docker 必须使用同一提交中的 `package-lock.json` 与 Prisma migrations。`.env 不在部署包内`，也不得提交数据库、日志、媒体或任何凭据。

当前数字人视频以灵眸播报和 EMO 有界竞速；8 秒无成功视频时立即使用本地头像与 Qwen TTS 继续面试。

## Windows 本地调试

从空依赖目录开始，严格按顺序执行：

```powershell
npm.cmd ci
npx.cmd prisma migrate deploy
npm.cmd run build
npm.cmd run dev
```

打开 `http://127.0.0.1:3000`。首次运行且数据库没有管理员时，访问 `/login` 会进入 `/setup`，由操作者初始化第一个超级管理员；不要通过种子脚本制造默认密码。

复制 `.env.example` 为 `.env` 后，至少填写 `AI_CONFIG_SECRET`、`RECRUITMENT_SESSION_SECRET` 和部署需要的应急 `ADMIN_PASSWORD`。`AI_CONFIG_SECRET` 用于加密后台保存的 AI/媒体凭据并签名后台会话；用密码生成器或 `openssl rand -base64 48` 生成。云端 API Key、灵眸 RAM AccessKey、OSS RAM AccessKey 只能在加密管理员 UI 输入，不能写进 `.env`。

## Linux 原生部署

要求 Node.js 22 LTS、npm 和项目完整源码。部署包方式必须包含 `package.json`、`package-lock.json`、`prisma/migrations/`、`scripts/`、`app/`、`components/` 与 `lib/`，但排除 `.env`、`node_modules`、`.next`、`data`、测试报告和临时媒体。

```bash
git switch feature/alibaba-multimodal-integration
git pull
cp .env.example .env
# 在服务器本机填写服务端密钥；不要把凭据写入本文档或 shell 历史
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start
```

也可使用已提供脚本：

```bash
chmod +x scripts/linux/*.sh
scripts/linux/setup.sh
scripts/linux/start.sh
```

`setup.sh` 同样执行 `npm ci` 和 `npm run db:migrate:deploy`，不会使用 `prisma db push`。首次运行仍通过浏览器 `/setup` 初始化超级管理员。生产 `APP_ORIGIN` 必须是唯一公开的 HTTP/HTTPS origin，不能带路径、查询、凭据或片段。

## Docker Compose

Docker 镜像从当前源码和当前 lockfile 构建，入口先校验环境、执行 `prisma migrate deploy`，再启动自定义 Next.js/WS 服务：

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 interview-coach
```

Compose 健康检查仅访问公开 `/api/health`，这是免费的配置级应用与数据库就绪检查，不会创建灵眸/EMO 任务，也不会调用任何付费诊断。不要把付费诊断加进 `HEALTHCHECK`、启动脚本或监控探针。

任何 Docker 测试结束后必须彻底关闭：

```bash
docker compose down --remove-orphans
docker desktop stop
```

不要使用 `docker compose down -v`，命名卷 `app-data:/app/data` 保存 SQLite 数据。

## Nginx 与 HTTPS

同一端口同时承载 Next.js HTTP 和 `/ws/asr` 同源 WebSocket：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

公网必须使用 HTTPS；页面、API 和 WebSocket 必须同源。浏览器只能拿到本站短期票据，不能拿到上游地址、永久 API Key 或 OSS 签名能力。

## 真实服务核对表（不含凭据）

不要把凭据写入本文档；在管理员 UI 中逐项确认：

- 私有 OSS：地域、Endpoint、私有 Bucket、随机对象前缀、独立最小权限 RAM 已保存；
- 百炼：`region`、`workspaceId`、当前 ASR/TTS 模型与音色已选择；
- 灵眸播报：当前播报模型、模板 ID 和模板变量映射已保存；
- EMO：当前模型、合规肖像、画幅配置和可访问的临时音频已保存；
- 面试官：一套共享人物或两位面试官配置均有不可变肖像尺寸元数据；
- 运行时：`AUTO_RACE` / `LINGMOU_ONLY` / `EMO_ONLY` 选择符合本次测试；
- 安全：候选人响应、日志和审计中无密钥、签名 URL、完整上游响应或候选人隐私。

`GET /api/ai-services/diagnostics` 可做管理员鉴权后的免费配置检查，例如 `curl -u` 使用本机临时输入的管理员凭据。真实连通测试不会自动执行。数字人视频付费诊断必须在 UI 中明确二次确认；它可能创建真实任务并计费。未配置时预期显示 `NOT_CONFIGURED`，不能用 mock/fake 宣称可达。

百炼 Workspace/API Key 与灵眸 RAM AccessKey 是两套独立凭据；OSS 建议再使用独立的最小权限 RAM。招聘来源及浏览器授权记录由 `RECRUITMENT_SESSION_SECRET` 加密 recruitment API credentials and browser session state。

## 临时媒体

私有 OSS 对象只按需生成短期签名 URL。TTS 临时音频最长 1 小时，缓存视频和诊断产生的临时音频/视频最长 24 小时；服务启动后按固定周期删除到期对象并把数据库资产标记为已清理。Bucket 仍应设置不超过 24 小时的生命周期规则作为故障兜底。人物肖像是持久配置资产，不属于临时对象。

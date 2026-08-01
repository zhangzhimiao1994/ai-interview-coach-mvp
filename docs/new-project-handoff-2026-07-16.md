# AI 面试训练平台交接（2026-08-01）

## 当前基线

项目使用 Next.js 15、React 19、TypeScript、Prisma 5/SQLite、Vitest、自定义 HTTP/WebSocket 入口和 Docker Compose。当前工作分支为 `feature/alibaba-multimodal-integration`。所有环境使用同一 `package-lock.json` 和 Prisma migrations；生产禁止 `prisma db push`。

首次运行的数据库没有管理员时，浏览器通过 `/setup` 初始化超级管理员。服务端 `AI_CONFIG_SECRET` 加密管理员 UI 保存的 AI/媒体凭据并签名后台会话；百炼、灵眸和 OSS 云凭据不得放入明文环境变量。

## 当前数字人运行时

当前是阿里灵眸播报优先 + EMO 并发，动态追问谁先成功用谁。预设题优先缓存灵眸，明确失败才走 EMO；动态追问并发两路。候选人界面的等待计划是 3 秒启动 EMO 状态、6 秒等待阈值、8 秒本地 Qwen TTS 降级，面试不会被云视频无限阻塞。

两路人物配置可以相同，也可以作为两位面试官。胜出视频决定本轮人物；另一条链路的迟到结果不能替换当前播放。调试支持 `AUTO_RACE`、`LINGMOU_ONLY`、`EMO_ONLY`。

人物肖像必须有不可变 `portraitWidth` / `portraitHeight`。旧画像没有尺寸元数据，升级后需要重新上传/保存。OSS 为私有 Bucket，浏览器与上游只得到短期签名 URL。临时音频、视频和诊断对象最长保留 24 小时，由运行时清理器和 Bucket 生命周期双层清理。

## 安全与真实服务原则

- 云凭据只通过加密管理员 UI 保存，候选人 API 不返回凭据、上游原文或完整签名 URL；
- 自动化测试只验证静态合同、协议解析、真实 `Response` 或离线数据库边界，不能证明真实服务可达；
- 免费配置诊断不会创建云任务；付费灵眸/EMO 诊断必须由管理员在 UI 明确确认；
- 无真实凭据时显示 `NOT_CONFIGURED`，不得返回 mock/fake 成功；
- 行为分析只提供可观察证据和训练建议。

## 交接验证

Windows：

```powershell
npm.cmd ci
npx.cmd prisma migrate deploy
npm.cmd run build
npm.cmd run dev
```

Linux 使用同一 lockfile，执行 `npm ci`、`npx prisma migrate deploy`、`npm run build`、`npm run start`。完整步骤、Nginx 同源 WebSocket、Docker 与真实服务核对表见 `docs/linux-deployment.md`；阿里双视频配置与调试见 `docs/alibaba-video-digital-human-debugging.md`。

若启动 Docker，测试后必须执行：

```powershell
docker compose down --remove-orphans
docker desktop stop
```

不要删除 SQLite 命名卷，不要提交 `.env`、数据库、媒体、日志、浏览器授权状态或任何密钥。

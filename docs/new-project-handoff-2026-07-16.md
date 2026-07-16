# AI 面试训练平台新项目交接总结

## 1. 项目定位

这是一个面向求职者的 AI 面试训练服务。服务商通过后台创建候选人、公司/岗位模板和训练任务，求职者在电脑或手机浏览器中完成模拟面试，系统生成专业面试提纲、实时追问、行为信号记录和最终训练报告。

最终目标不是普通问卷，而是具备以下能力的实时面试训练系统：

- 针对目标公司、岗位和候选人材料生成专业题纲；
- AI 面试官根据回答实时追问，而不是播放固定问题；
- 使用麦克风、摄像头、语音识别、语音合成和数字人；
- 数字人具备可控表情和说话状态；
- 只分析可观察的行为信号，不做心理诊断、人格判断或测谎；
- 生成有证据、有评分解释、有改进动作和训练计划的报告；
- 支持多个 AI 服务商，并可为每项能力独立选择当前模型。

## 2. 代码仓库

- GitHub：`git@github.com:zhangzhimiao1994/ai-interview-coach-mvp.git`
- 当前开发分支：`feature/alibaba-multimodal-integration`
- 当前交接基线：`7e04d08 design AI configuration diagnostics`
- 原工作区：`C:\Users\张晟歌\Documents\Codex\2026-07-04\new-chat-2`
- 建议新工作区：`E:\code_x\ai-interview-coach-mvp`

用户要求所有功能更新都按时间顺序提交并及时推送，不能只保留最终版本。

## 3. 技术栈

- Next.js 15 App Router
- React 19、TypeScript、Tailwind CSS
- Prisma 5、SQLite
- Zod 输入校验
- Vitest 单元测试
- Playwright E2E
- Docker、Docker Compose
- Linux Shell、PM2、systemd 部署支持

主要目录：

```text
app/                 页面和 API 路由
components/          后台、面试房间、报告和 UI 组件
lib/ai/              文本 AI provider、模型路由和报告逻辑
lib/media/           STT、TTS、数字人、行为分析接口与配置解析
lib/domain/          领域常量、加密和模型推荐
lib/db/              Prisma、种子数据
prisma/              Schema 和生产 migration
scripts/linux/       Linux 部署脚本
docs/                设计、实施计划和部署说明
tests/unit/          单元与契约测试
```

## 4. 已完成功能

### 面试业务

- 候选人、公司模板、岗位模板、面试官模板和训练任务；
- 多阶段训练与阶段开关；
- 多种面试官风格；
- 专业面试提纲生成并保存到 `TrainingSession.outlineJson`；
- 回答必须匹配已保存题纲，避免客户端任意注入问题；
- 每轮回答调用 AI 生成即时反馈和追问；
- 最终报告包含总分、分项解释、逐题证据、能力风险、优先动作和周训练计划；
- `SessionTurn` 使用 `@@unique([sessionId, questionId])` 防止并发重复提交。

### AI 配置后台

- 服务商和模型可通过数据库配置；
- API Key 使用 AES-256-GCM 加密，页面只显示掩码；
- 支持结构化凭据和服务商/模型 settings；
- 模型可新增、停用、删除和切换；
- 同一能力只能有一个当前使用模型；
- 当前使用模型不能直接停用或删除，必须先选择替代模型；
- 服务商包含当前模型时不能直接停用；
- 支持 OpenAI、DeepSeek、通义百炼、火山方舟、智谱、MiniMax、自定义 OpenAI-compatible 等类型。

关键语义：

- `isDefault`：推荐参考，可以有多个，不影响运行时；
- `isSelected`：当前使用模型，每个能力只能有一个，运行时只读取它。

不要把“推荐默认”写成“当前选择”。

### 阿里多模态配置基础

后台已经预留并保存：

- 服务商公开参数：`region`、`workspaceId`、`rtcAppId`；
- 加密凭据：主 `apiKey`、`asrApiKey`、`rtcAppKey`；
- ASR 参数：语言、采样率、编码；
- TTS 参数：音色、采样率、格式；
- 数字人参数：`avatarId`、`voiceId`、`rtcMode`；
- 行为分析参数：最低置信度、抽帧间隔、最多帧数。

当前参考模型：

- ASR：`qwen3-asr-flash-realtime`
- TTS：`qwen3-tts-instruct-flash-realtime`
- 实时数字人：`avatar-dialog`
- 行为分析：`qwen3.6-flash`

这些只是可编辑参考，不会自动成为当前使用模型。

### 安全与可靠性

- `/admin`、`/api`、`/practice` 当前由 Basic Auth 保护；
- `/api/health` 是无需认证的数据库就绪检查；
- 生产启动拒绝占位 `ADMIN_PASSWORD` 和 `AI_CONFIG_SECRET`；
- 创建会话有内存限流和过期桶清理；
- AI 请求支持指数退避、429/5xx/超时重试；
- 不支持 `response_format` 时自动关闭 JSON Mode 重试；
- 可提取 Markdown code block 中的 JSON；
- AI 结构化输出错误映射为安全的 `502`；
- 已选择真实模型失败时不再静默切换 Mock；
- 只有没有选择模型时才允许使用演示 Mock。

### 部署

- Docker Compose 使用命名卷 `app-data:/app/data` 保存 SQLite；
- 容器启动使用 `prisma migrate deploy`；
- Docker 健康检查调用 `/api/health`；
- Linux setup、migrate、start 脚本已经提供；
- 支持 PM2、systemd、Nginx 和 HTTPS 反向代理；
- 生产启动前执行 `scripts/validate-production-env.mjs`。

## 5. 当前未完成任务

### 第一优先级：配置诊断与 Docker 同步

设计已经确认并提交，但实现尚未开始：

`docs/superpowers/specs/2026-07-16-ai-configuration-diagnostics-design.md`

需要实现：

- `GET /api/ai-services/diagnostics`：读取全部能力状态；
- `POST /api/ai-services/diagnostics`：检查指定能力；
- 文本模型最小真实连通测试；
- 阿里 ASR、TTS、Avatar、行为分析必填参数诊断；
- 后台诊断面板和主动检查按钮；
- 不自动触发付费调用；
- Docker 和 Linux 部署契约、文档、验证命令同步更新。

### 第二优先级：真实多模态适配器

目前 `lib/media/` 已有统一接口和动态配置解析，但以下真实调用尚未完成：

- 阿里实时 ASR WebSocket；
- 阿里实时 TTS；
- 阿里 Avatar/RTC 数字人会话；
- 抽帧视觉行为分析；
- 面试房间统一媒体状态机；
- 数字人说话、倾听、追问等表情状态；
- 摄像头抽帧授权、隐私提示和最小化上传；
- 视觉行为证据写入最终报告。

现有接口仍有浏览器或客户端 fallback，不能将其描述为真实数字人服务已完成。

### 上线前安全任务

- Basic Auth 升级为 Auth.js/Session/JWT；
- 增加 CSRF 保护；
- 单机 Map 限流迁移 Redis；
- 管理员操作审计日志；
- 结构化日志或 Sentry；
- 多租户和正式用户权限模型。

### 扩容任务

- SQLite 迁移 PostgreSQL；
- 追问使用显式父子关系，替代 `::follow-up::1` 字符串约定；
- 面试房间状态机；
- 报告分页或虚拟列表；
- 更多网络异常和移动端 E2E。

## 6. 验证基线

最近一次功能验证：

- 30 个测试文件通过；
- 213 项测试通过；
- `npx tsc --noEmit` 通过；
- `npm run build` 通过。

常用命令：

```bash
npm ci
npm run db:generate
npm run db:migrate:deploy
npm test
npx tsc --noEmit
npm run build
npm run dev
```

开发地址通常为 `http://127.0.0.1:3000`。摄像头和麦克风在公网必须使用 HTTPS；本机 `localhost`/`127.0.0.1` 可作为安全上下文使用。

## 7. 环境变量

从 `.env.example` 创建 `.env`，不要把 `.env` 提交到 Git：

```env
DATABASE_URL="file:./data/prod.db"
PORT=3000
RUN_DB_SEED=false
AI_PROVIDER=database
AI_CONFIG_SECRET="替换为独立随机密钥"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="替换为强密码"
```

生产环境不能使用 `change-this-before-production`。迁移工作区时需要单独迁移 `.env` 和需要保留的 `data/prod.db`，它们不会通过 GitHub 下载。

## 8. 迁移到 E 盘建议

推荐重新克隆，不直接剪切当前工作区：

```powershell
New-Item -ItemType Directory -Force E:\code_x
Set-Location E:\code_x
git clone git@github.com:zhangzhimiao1994/ai-interview-coach-mvp.git
Set-Location E:\code_x\ai-interview-coach-mvp
git switch feature/alibaba-multimodal-integration
npm ci
npm run db:generate
```

如需保留当前本地配置和数据，再从旧目录复制：

```powershell
Copy-Item "C:\Users\张晟歌\Documents\Codex\2026-07-04\new-chat-2\.env" "E:\code_x\ai-interview-coach-mvp\.env"
Copy-Item -Recurse "C:\Users\张晟歌\Documents\Codex\2026-07-04\new-chat-2\data" "E:\code_x\ai-interview-coach-mvp\data"
```

然后验证：

```powershell
Set-Location E:\code_x\ai-interview-coach-mvp
npm run db:migrate:deploy
npm test
npm run build
```

确认 E 盘版本、`.env`、数据库、测试和构建都正常后，再自行决定是否清理 C 盘旧目录。不要在未验证前删除旧目录。

## 9. Docker 使用

Docker 与源码版必须始终从同一分支同步构建：

```bash
git pull
docker compose up -d --build
docker compose ps
docker compose logs -f interview-coach
```

修改外部端口：

```env
PORT=8080
```

Docker 数据位于命名卷，不要使用 `docker compose down -v`，否则会删除数据库卷。

## 10. 重要开发规则

1. 每个完成阶段单独提交并推送，不覆盖历史版本；
2. 先写失败测试，再实现；
3. 使用 Prisma migration，不在生产使用 `db push`；
4. 不提交 `.env`、数据库、API Key、RTC Key 或候选人隐私数据；
5. 推荐模型不等于当前使用模型；
6. 真实模型失败不能静默返回 Mock；
7. 数字人、语音、行为分析未通过真实服务检查前，界面必须明确显示 fallback 或未适配；
8. Docker、Linux 和源码部署必须同步更新并一起验证；
9. 行为分析只输出可观察证据和训练建议；
10. 正式公网使用必须配置 HTTPS。

## 11. 关键提交

```text
7e04d08 design AI configuration diagnostics
4dbf508 add editable Alibaba media defaults
e2963e7 make AI provider failures explicit and retryable
c9426c3 harden production startup and health checks
9449f87 add dynamic media provider contracts
60b6f26 separate recommended and selected AI models
db554cf clarify current model selection semantics
```

新项目或新会话应从 `feature/alibaba-multimodal-integration` 分支和本交接文档继续，不要从早期 Mock 演示版本重新开始。

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

所有项目通用 Docker 调试收尾规则：

1. 以后所有项目只要启动过 Docker 容器，调试结束必须执行 `docker compose down --remove-orphans`；
2. 不要使用 `docker compose down -v`，避免删除数据库命名卷；
3. 调试结束必须执行 `docker desktop stop` 或确认 Docker Desktop 已关闭；
4. 交接或汇报时需要明确说明 Docker 当前是否仍在运行。

## 10. 重要开发规则

1. 每个完成阶段单独提交并推送，不覆盖历史版本；
2. 先写失败测试，再实现；
3. 使用 Prisma migration，不在生产使用 `db push`；
4. 不提交 `.env`、数据库、API Key、RTC Key 或候选人隐私数据；
5. 推荐模型不等于当前使用模型；
6. 真实模型失败不能静默返回 Mock；
7. 数字人、语音、行为分析未通过真实服务检查前，界面必须明确显示 fallback 或未适配；
8. Docker、Linux 和源码部署必须同步更新并一起验证；如使用 Docker 调试，调试结束必须关闭 Docker Desktop；
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

## 12. 2026-07-23 本地进展：硅基 DUIX 数字人接入

本轮从 `feature/alibaba-multimodal-integration` 继续开发，项目展示名保持为“开发面试数字人”，远端仓库仍是 `zhangzhimiao1994/ai-interview-coach-mvp`。按用户最新要求，本轮只做本地提交，不推送 GitHub。

已完成并本地提交：

- `eeeadce design: add DUIX digital human integration`
- `681a391 plan: add DUIX implementation plan`
- `ac4321c feat: add DUIX provider configuration`
- `a13f731 feat: support DUIX digital human sessions`
- `bb031e9 feat: drive interview room with DUIX avatar`

已实现范围：

- 新增 `DUIX` 服务商类型和后台配置字段：`appId`、`appSecret`、`platform`。
- 新增 DUIX 实时数字人模型设置：`conversationId`、`interactionMode=direct-drive`、`speechMode=duix-managed`。
- 服务端使用 DUIX `appSecret` 生成短期 HS256 JWT sign，只向浏览器返回 `sign`、`conversationId` 和 H5 SDK 所需公开元数据，不暴露 `appSecret`。
- 数字人会话新增 `DUIX_H5` 模式；DUIX 配置缺失或签名失败时降级到 `LOCAL_AVATAR`，不自动切到灵眸以避免额外付费调用。
- 面试房间新增 DUIX H5 SDK 客户端，支持 `init/start/speak/break/stop` 生命周期；DUIX 播报时不再走 `/speech` 的 CosyVoice 音频流。
- Docker 源码包同步包含 `duix-guiji`、`duix-guiji.d.ts` 和 `lib/client/duixAvatarClient.ts`；Dockerfile 的 `npm ci` 已加 BuildKit npm cache 和 fetch retry，降低 registry 抖动失败概率。

已通过验证：

- `npm.cmd test -- tests/unit/linux-deployment-package.test.ts`
- `npm.cmd test`
- `npm.cmd run build`

Docker 验证状态：

- 已临时启动 Docker Desktop 并尝试 `docker compose build`。
- 第一次 Docker 构建在容器内 `npm ci` 阶段失败：`ECONNRESET`，属于 Docker 内 npm registry 网络连接中断。
- 已更新 Dockerfile 为缓存和重试安装后再次尝试；第二次仍长时间停在容器内 `npm ci` 网络下载阶段。
- 为避免占用内存，已执行 `docker compose down --remove-orphans` 并执行 `docker desktop stop` 关闭 Docker Desktop。
- 因 Docker 内 registry 网络阻塞，本轮没有完成 Docker 镜像健康检查；源码测试和 Next 生产构建已通过。

继续建议：

1. 网络稳定后重新执行 `docker compose build`。
2. 构建成功后执行 `docker compose up -d`、`docker compose ps`、访问 `/api/health`。
3. 验证后执行 `docker compose down --remove-orphans` 和 `docker desktop stop`。
4. 用户明确恢复推送授权后，再推送本地提交到 GitHub。

## 13. 2026-07-24 本地进展：Qwen-Omni 全模态调试项

本轮新增百炼 Qwen-Omni 作为可选调试模型。用户口头提到 `qwen3-omni-plus`，当前阿里云百炼官方文档和示例使用的模型名为 `qwen3.5-omni-plus`，代码中按官方模型名配置。

已实现范围：

- 在模型推荐矩阵中新增 `INTERVIEW_FOLLOW_UP` / `qwen3.5-omni-plus`：用于“全模态接管调试”，手动设为当前模型后可接管候选人回答后的追问和即时反馈。
- 在模型推荐矩阵中新增 `VISION_BEHAVIOR_ANALYSIS` / `qwen3.5-omni-plus`：用于“全模态行为调试”，手动设为当前模型后可作为多模态观察入口。
- 百炼服务商存在时，种子逻辑会额外生成两个可编辑模型：`omni-follow-up-takeover` 和 `omni-behavior-debug`，均不默认设为当前模型。
- TONGYI 文本/全模态接管链路支持从结构化百炼凭据 `credentials.apiKey` 读取密钥；当 provider 未单独设置 baseUrl 时，会按 `workspaceId + region` 生成百炼 OpenAI 兼容地址：`https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`。

使用方式：

1. 后台确认阿里百炼服务商已启用，并配置 `apiKey`、`workspaceId`、`region`。
2. 如果要让全模态模型接管追问，把 `阿里百炼 Qwen-Omni 全模态接管调试` 设为 `专业追问` 的当前使用模型。
3. 如果只做全模态观察/行为调试，把 `阿里百炼 Qwen-Omni 全模态行为调试` 设为 `神态/行为分析` 的当前使用模型。
4. 默认不要同时替换稳定追问链路和行为分析链路；先单项测试，确认费用、延迟和输出结构稳定后再扩大范围。

新项目或新会话应从 `feature/alibaba-multimodal-integration` 分支和本交接文档继续，不要从早期 Mock 演示版本重新开始。

## 14. 2026-07-25 本地进展：首次运行初始化与后台用户管理

本轮新增数据库管理员体系，用于“让谁能登录、让谁不能登录”。仍在 `feature/alibaba-multimodal-integration` 分支继续，远程仓库仍为 `zhangzhimiao1994/ai-interview-coach-mvp`。

已实现范围：

- 新增 `AdminUser` Prisma 模型和迁移：保存管理员用户名、显示名、密码哈希、角色、启用状态和最近登录时间。
- 新增首次运行初始化流程：当数据库中没有管理员时，访问 `/login` 会跳转到 `/setup`，由用户配置第一个超级管理员账号和密码。
- 新增数据库登录流程：`/api/auth/login` 校验启用状态和密码，成功后写入签名 HttpOnly Cookie；禁用用户无法登录。
- 新增后台用户管理页：`/admin/users` 支持新增管理员、启用/禁用登录、调整角色、重置密码和退出登录。
- 后台导航和首页新增“用户管理”入口。
- Middleware 支持签名后台会话，并保留 `.env` Basic Auth 作为过渡/应急入口；API 请求未认证时返回 401，不再跳转到登录页。

已通过验证：

- `npm.cmd test -- tests/unit/admin-auth-session.test.ts tests/unit/admin-users.test.ts tests/unit/admin-auth-routes.test.ts tests/unit/admin-user-routes.test.ts`
- `npm.cmd run build`
- `npm.cmd test`

注意事项：

1. 部署或本机数据库升级需要执行 Prisma migration/deploy 或相应初始化流程，确保 `AdminUser` 表存在。
2. `AI_CONFIG_SECRET` 必须保持为足够长且稳定的随机字符串；它用于签名后台登录 Cookie，改动后旧登录会话会失效。
3. 当前禁用用户会阻止新登录；已经签发的 Cookie 在过期前仍可能有效。若后续需要“禁用后立即踢下线”，建议新增服务端 Session 表或 sessionVersion 校验。
4. 不提交 `.env`、数据库、API Key、候选人隐私数据或任何运行时日志。
# 2026-07-25 更新：Qwen-Audio-TTS 与全模态接管开关

本轮继续在 `feature/alibaba-multimodal-integration` 分支开发，项目展示名仍为“开发面试数字人”，远端仓库仍是 `zhangzhimiao1994/ai-interview-coach-mvp`。用户明确要求：不要使用 mock 证明真实服务可用；如果使用 Docker 调试，结束后必须关闭 Docker。本轮没有启动 Docker。

已实现范围：

- 语音合成默认推荐和种子从 CosyVoice 主线调整为 `qwen-audio-3.0-tts-flash`，默认音色为 `longanhuan_v3.6`，输出仍为 48k PCM 单声道，保留 `cosyvoice-v3-flash` 作为备选模型。
- 阿里 TTS HTTP 适配器支持 `qwen-audio-3.0-tts-flash` 请求体，保留文本中的 `[whisper]`、`[laughs]`、`[angry]` 等内联情绪标签，并允许通过 `instruction` 传入自然语言风格指令。
- 数字人播报链路新增面试情境 TTS 风格生成：根据阶段、问题意图和文本中的内联情绪标签动态组合语气指令；如果模型 settings 显式配置 `stageVoices`，可按阶段切换安全音色。
- 后台“新增模型”加入模型预设下拉框：主流推荐可直接选择；列表中没有的模型走“自定义”后手动配置。TTS 预设会把音色、采样率、声道、情绪指令同步填到能力设置字段。
- 新增 `AiRuntimeSetting` 表和 `/api/ai-services/multimodal-takeover` 路由，用于保存“全模态接管开关”。
- 后台 AI 配置页新增独立的“全模态接管开关”：开启后可指定已启用的 Qwen Omni 模型，并选择覆盖能力。当前默认覆盖 `INTERVIEW_FOLLOW_UP` 与 `VISION_BEHAVIOR_ANALYSIS`。
- 运行时模型选择规则改为：单项能力当前模型优先；如果该能力没有单独选中模型，且全模态接管开关开启、能力在覆盖列表中、指定模型是启用的 Qwen Omni，则回退到该 Omni 模型。
- 配置诊断会识别被 Omni 接管的能力，并返回 `MULTIMODAL_TAKEOVER_ENABLED`，避免误报“该能力尚未选择当前使用模型”。

重要约束：

1. 全模态接管当前不替代 `SPEECH_TO_TEXT`、`TEXT_TO_SPEECH` 和 `DIGITAL_HUMAN_REALTIME` 的真实适配器；这些链路仍然需要各自的真实配置。
2. `qwen3.5-omni-plus` 为当前推荐预设；`qwen3-omni-plus` 作为用户已提到的名称在规则中保留兼容，但实际可用模型名以阿里云百炼控制台和官方文档为准。
3. 不要用 mock 结果声明真实服务可用。没有真实 API Key/服务额度时，只能做配置校验、纯函数测试、迁移测试和构建测试。
4. 升级数据库需要执行 Prisma migration/deploy，确保 `AiRuntimeSetting` 表和 Qwen-Audio-TTS 默认迁移落库。

本轮已通过验证：

- `npm.cmd test -- tests/unit/alibaba-tts.test.ts tests/unit/interview-tts-style.test.ts tests/unit/model-recommendations.test.ts tests/unit/seed-ai-models.test.ts tests/unit/qwen-audio-tts-default-migration.test.ts tests/unit/multimodal-takeover.test.ts tests/unit/multimodal-takeover-persistence.test.ts tests/unit/ai-model-selection.test.ts tests/unit/ai-service-routes.test.ts tests/unit/ai-service-selection-ui.test.tsx tests/unit/ai-diagnostics-page.test.tsx tests/unit/ai-diagnostics.test.ts`
- `npx.cmd prisma generate`
- `npm.cmd test`
- `npm.cmd run build`

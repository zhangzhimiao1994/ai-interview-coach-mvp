# 数字人、语音与行为接口

## 当前媒体链路

- 语音识别：阿里实时识别优先，失败时明确显示浏览器识别降级；浏览器只连接本站 `/ws/asr`。
- 面试官语音：阿里真实语音优先，当前首选 Qwen Audio TTS；`cosyvoice-v3-flash` 可作为兼容备选，失败时显示浏览器语音降级。
- 异步视频：阿里灵眸播报优先，动态追问与 EMO 并发，谁先成功用谁；没有成功视频时继续本地头像与 Qwen 情绪 TTS。
- 行为分析：仅陈述可观察信号与训练建议，不做心理诊断、人格判断或测谎。

## 语音配置

百炼公开设置为 `region`、`workspaceId`；`apiKey`、`asrApiKey`、`ttsApiKey` 只能在管理员 UI 加密保存。ASR 推荐 `qwen3-asr-flash-realtime`。模型只有设为当前使用（isSelected）后才参与运行，推荐参考不参与运行时路由。

`POST /api/speech-recognition/sessions` 校验训练会话并签发一次性短期票据；同进程 WebSocket 网关消费票据。TTS 和本地降级响应均使用 `no-store`，切题、重播和卸载会取消旧播放。

## 双视频编排

预设题优先预生成灵眸视频；灵眸明确失败时才为预设题启用 EMO 备用。动态追问同时建立灵眸和 EMO 尝试，人物可以相同，也可以配置为两位面试官；胜出人物负责本轮提问，迟到结果不能抢占正在播放的视频。

动态任务对灵眸和 EMO 两路立即各提交一次。协议调度在 3 秒和 6 秒轮询灵眸，8 秒轮询 EMO 并原子决定胜者或执行 8 秒本地 Qwen TTS 降级。

调试模式：

- `AUTO_RACE`：预设题灵眸优先，动态追问双服务竞速；
- `LINGMOU_ONLY`：只提交灵眸；
- `EMO_ONLY`：只提交 EMO。

普通配置诊断只检查数据库配置，不产生费用。真实短任务诊断可能产生费用，必须由管理员在 UI 明确二次确认；自动化测试或注入结果不能作为真实服务可达证明。

## 私有媒体与清理

肖像、音频和视频保存在私有 OSS，数据库只保存不透明对象键。调用上游或候选人播放时生成短期签名 URL，普通 API、日志和审计不得保存完整签名 URL。

新版肖像资产新增不可变 `portraitWidth` / `portraitHeight` 元数据。迁移前保存的旧画像没有该元数据，不能继续用于新视频任务，必须重新上传或重新保存。音频使用 1 小时、视频使用 23 小时到期值；运行时清理器带持久 lease 重试删除，Bucket 生命周期是应用断网、停机或凭据失效时的独立兜底。

## API 边界

- `POST /api/digital-human/renders`：创建/复用预设任务或动态竞速；
- `GET /api/digital-human/renders/:id`：只返回候选人所属任务的安全状态与短期播放地址；
- `POST /api/ai-services/digital-human-video-diagnostics`：管理员配置诊断或显式付费诊断；
- `POST /api/behavior-analysis`：接收可观察信号，输出 `observations`、`risks` 与 `coachingTips`。

所有运行时失败必须给出明确降级或安全错误码，不能静默伪造成阿里成功。

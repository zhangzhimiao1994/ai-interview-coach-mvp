# 多模型语音、数字人与行为分析适配设计

## 1. 目标

在现有 AI 面试训练系统中，把已经预留的语音合成、实时数字人和神态/行为分析能力接成可运行的供应商调用链。

本阶段采用插件式能力适配器，不把供应商逻辑写死在页面或 API 路由中。首批优先使用阿里云能力：

- `qwen3-tts-flash`：真实中文语音合成。
- `avatar-dialog`：实时 2D 数字人，取得邀测权限并完成 RTC 配置后启用。
- `qwen3-vl-flash`：候选人抽帧行为分析。
- Tavus CVI：保留第二实时数字人适配器和正式配置契约，取得账号后联调。
- Gemini：保留第二视觉分析适配器和正式配置契约，取得 API Key 后联调。

本阶段不建设独立媒体网关，不支持应用多实例共享实时数字人会话。MVP 运行在单个 Node.js 应用实例中；未来需要水平扩展时，再把会话状态迁移到独立媒体网关。

## 2. 设计原则

1. 面试主流程只依赖统一能力接口，不感知具体供应商。
2. API Key、RTC AppKey 等密钥只在服务端解密和使用。
3. 供应商调用失败必须真实记录，降级结果不能伪装成原供应商成功。
4. 行为分析只描述可观察信号，不做心理、人格、健康、年龄、种族或测谎判断。
5. 原始摄像头抽帧默认不落库，分析完成后丢弃。
6. 页面关闭、刷新、超时或异常断线时都必须释放实时数字人会话。

## 3. 运行模式

系统按照后台默认模型和配置状态选择运行模式。

### 3.1 阿里实时数字人

当 `DIGITAL_HUMAN_REALTIME` 的默认模型为阿里 `avatar-dialog`，且百炼权限与 RTC 配置检查通过时：

1. 服务端创建 `avatar-dialog` WebSocket 会话和 RTC 会话。
2. 面试官问题通过阿里 TTS 生成单声道 PCM 音频。
3. PCM 音频发送给 `avatar-dialog` 驱动数字人。
4. 前端通过 RTC 接收数字人画面和声音。
5. 前端不再单独播放 TTS 音频，避免重复声音。

### 3.2 Tavus 实时数字人

当默认模型切换为 Tavus，且 API Key、`personaId` 和 `replicaId` 完整时：

1. 服务端创建 Tavus Conversation。
2. 前端使用服务端返回的受控会话 URL 或 meeting token 加入视频房间。
3. Tavus 负责实时声音、视频和轮次控制。
4. 阿里 TTS 不在该模式下重复播放。

首批交付包含适配器、配置校验和测试模式，不要求在没有 Tavus 账号时完成真实联调。

### 3.3 本地数字人加阿里 TTS

当实时数字人未配置、未获权限或启动失败时：

1. 保留现有本地数字人组件。
2. `qwen3-tts-flash` 返回真实音频 URL 或音频数据。
3. 前端使用 `<audio>` 播放，并根据播放事件驱动嘴型和状态。
4. 页面显示“阿里语音 / 本地数字人”运行模式。

### 3.4 浏览器语音降级

阿里 TTS 调用失败时才使用浏览器 `speechSynthesis`。页面必须显示“浏览器语音降级”，调用日志记录原始失败原因和降级服务。

## 4. 适配器边界

新增三个独立能力接口。

### 4.1 语音合成

```ts
interface TextToSpeechProvider {
  synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>;
  checkConnection(): Promise<CapabilityCheckResult>;
}
```

`SpeechSynthesisResult` 统一包含：

- `provider`
- `model`
- `mode`
- `audioUrl` 或 `audioBase64`
- `mimeType`
- `sampleRate`
- `expiresAt`
- `fallbackUsed`
- `traceId`

### 4.2 实时数字人

```ts
interface RealtimeDigitalHumanProvider {
  createSession(input: DigitalHumanSessionInput): Promise<DigitalHumanSessionResult>;
  speak(sessionId: string, input: DigitalHumanSpeakInput): Promise<DigitalHumanSpeakResult>;
  stopSession(sessionId: string): Promise<void>;
  checkConnection(): Promise<CapabilityCheckResult>;
}
```

`DigitalHumanSessionResult` 统一包含：

- 内部会话 ID
- 供应商会话 ID
- RTC 或 WebRTC 连接信息
- 供应商与模型名称
- 会话过期时间
- 当前运行模式

### 4.3 行为分析

```ts
interface BehaviorAnalysisProvider {
  analyze(input: BehaviorAnalysisInput): Promise<BehaviorAnalysisResult>;
  checkConnection(): Promise<CapabilityCheckResult>;
}
```

适配器由能力路由器根据后台默认模型选择。新增火山、腾讯、HeyGen、D-ID 或 AKOOL 时，只新增适配器并注册，不修改面试主流程。

## 5. API 设计

### 5.1 创建数字人会话

`POST /api/digital-human/sessions`

请求包含训练会话 ID、数字人角色、语言和当前面试上下文。响应返回统一数字人会话对象。创建操作支持幂等键，避免重复点击产生多个计费会话。

### 5.2 播报问题

`POST /api/digital-human/sessions/:id/speak`

请求包含问题文本、表达状态和面试阶段。表达状态限定为：

- `neutral`
- `encouraging`
- `listening`
- `probing`
- `skeptical`
- `serious`
- `summary`

阿里适配器把 TTS PCM 发送给 `avatar-dialog`；Tavus 适配器使用其会话能力；本地模式返回可直接播放的 TTS 结果。

### 5.3 停止数字人会话

`DELETE /api/digital-human/sessions/:id`

停止操作必须幂等。即使供应商返回“会话已结束”，本地状态也应标记为已释放。

### 5.4 独立语音合成

`POST /api/digital-human/speech`

保留现有接口路径，改为调用 `TextToSpeechProvider`。请求支持文本、声音、语言、语速和表达指令。

### 5.5 行为分析

`POST /api/behavior-analysis`

请求包含：

- `sessionId`
- `questionId`
- 面试阶段和问题文本
- 候选人回答转写
- 本地音频行为信号
- 最多 8 张压缩 JPEG 抽帧
- 用户是否同意视觉分析

响应包含结构化评分、证据、置信度、限制说明和训练建议。

## 6. 后台配置

后台配置拆分为三层。

### 6.1 服务商凭据

服务商保存通用连接信息和加密凭据 JSON。现有单一 API Key 字段继续兼容，新增多密钥字段用于 RTC 等供应商特有凭据。

阿里服务商凭据：

- 百炼 API Key
- RTC AppKey

阿里公开设置：

- 百炼区域
- Workspace ID
- RTC App ID
- RTC 区域

Tavus 凭据和设置：

- API Key
- Persona ID
- Replica ID

Gemini 凭据和设置：

- API Key
- API 区域或 Vertex 项目标识（启用 Vertex 时）

### 6.2 模型配置

每个模型继续绑定单一能力，并新增供应商特有的非敏感 `settingsJson`：

- TTS：声音、语言、语速、采样率、输出格式。
- 数字人：头像 ID、会话最长时长、空闲超时。
- 行为分析：抽帧间隔、最多帧数、图片质量、超时、最低置信度。

### 6.3 连接检测

后台提供逐能力检测，而不是只检查服务商地址是否可达：

1. 验证百炼 API Key。
2. 合成一条短测试语音。
3. 检查 `avatar-dialog` 邀测权限。
4. 检查 RTC App ID 和 AppKey。
5. 使用无敏感内容的测试图片检查视觉模型结构化输出。
6. Tavus 使用 `test_mode` 验证会话创建而不产生正式视频会话费用。

检测结果显示成功项、失败项、错误码、修复建议和检测时间。

## 7. 候选人行为分析

### 7.1 采集

候选人明确同意后，回答期间约每 5 秒抽取一帧，每题最多 8 帧。图片在浏览器压缩为 JPEG 后发送。分析完成后服务端不保存原图，也不把原图写入日志。

本地同时采集：

- 回答时长
- 转写长度
- 平均音量和峰值音量
- 长停顿次数
- 摄像头和麦克风状态
- 是否使用语音识别

### 7.2 输出结构

视觉模型输出以下可观察维度：

- 镜头关注度
- 画面稳定度
- 可见表情参与度
- 姿态与取景专业度
- 环境干扰
- 采样质量

每项包含：

- `score`：0 到 100
- `observations`：可观察事实
- `evidenceFrames`：证据帧序号
- `confidence`：0 到 1
- `coachingTips`：可执行训练建议

综合表达稳定性由视觉结果和本地音频信号共同计算。低于后台最低置信度的维度不进入总分，只显示“证据不足”。

### 7.3 禁止输出

系统提示词、结构校验和发布前检查共同禁止以下内容：

- 心理状态或人格诊断
- 测谎结论
- 健康或精神状态判断
- 年龄、种族等敏感属性推断
- 没有证据帧支持的结论

## 8. 数据持久化

`SessionTurn` 保存：

- 本地行为信号 JSON
- 结构化视觉分析 JSON
- 行为分析供应商和模型
- 分析状态
- 分析置信度

不保存原始抽帧。实时数字人会话保存供应商会话 ID、状态、创建时间、停止时间和停止原因，便于异常回收与费用排查，但不保存供应商密钥或 meeting token。

## 9. 前端状态

数字人组件支持以下状态：

- 初始化
- 正在连接
- 正在提问
- 等待回答
- 正在分析
- 已降级
- 连接失败
- 已结束

页面固定显示当前运行模式，例如“阿里实时数字人”“本地数字人 + 阿里语音”“浏览器语音降级”。候选人可以关闭视觉分析，但关闭摄像头不会阻止使用麦克风回答。

浏览器自动播放受限时，第一次播放由“开始面试”用户操作解锁。后续问题可以自动播放。桌面和手机都使用当前设备的摄像头与麦克风。

## 10. 错误处理与日志

每次供应商尝试都记录：

- 能力
- 供应商和模型
- 真实成功状态
- AI 调用耗时
- 失败原因和供应商错误码
- 是否降级
- 实际降级服务商
- 供应商 trace ID

错误响应不包含密钥、图片、音频或完整供应商响应。适配器只对短暂网络错误执行一次安全重试，创建计费会话的请求必须带幂等键。

实时数字人会话通过以下路径释放：

1. 正常完成面试。
2. 用户点击退出。
3. 页面 `pagehide` 事件触发退出请求。
4. 服务端空闲超时回收。
5. 应用启动时扫描遗留活动会话并尝试停止。

## 11. 隐私与安全

1. 摄像头和视觉分析分别获得用户同意。
2. 用户拒绝视觉分析时，系统只保留本地音频行为信号。
3. 摄像头、麦克风和 RTC 仅允许在 HTTPS 或 localhost 下运行。
4. 密钥采用现有加密机制保存，生产环境拒绝占位加密密钥。
5. 行为分析请求限制图片数量、尺寸和总请求体大小。
6. 服务端验证会话归属和问题 ID，不能把任意图片注入其他候选人的会话。
7. 管理员可以全局关闭视觉分析或某个供应商。

## 12. 测试与验收

### 12.1 自动测试

- 适配器契约测试。
- 后台默认模型路由测试。
- 阿里 TTS 请求和响应解析测试。
- 阿里、Tavus 数字人会话创建、播报和释放测试。
- 视觉模型结构化输出和禁止字段测试。
- 图片不落库和日志脱敏测试。
- 供应商失败、降级标识和真实调用日志测试。
- 幂等创建与重复停止测试。
- 前端音频播放、数字人状态和抽帧上限测试。

CI 使用模拟供应商响应，不依赖真实 API Key，也不产生供应商费用。

### 12.2 人工验收

1. 桌面 Chrome 通过 HTTPS 播放真实阿里 TTS。
2. 手机 Chrome 通过 HTTPS 播放真实阿里 TTS，并使用手机摄像头和麦克风。
3. `qwen3-vl-flash` 对一组明确同意的测试抽帧返回合规结构化分析。
4. 未取得 `avatar-dialog` 权限时，后台明确显示邀测或 RTC 配置缺失。
5. 取得权限后，阿里 RTC 数字人能够播报问题并在提问后进入等待回答状态。
6. 任一供应商故障时面试可以继续，页面明确显示实际降级模式。
7. 面试退出后确认供应商会话已停止，不再继续计费。

## 13. 实施顺序

1. 扩展数据库配置与会话记录。
2. 建立三类适配器接口、能力路由和标准错误。
3. 接入真实阿里 TTS，并改造前端音频播放。
4. 接入 `qwen3-vl-flash` 抽帧分析和报告存储。
5. 实现阿里 `avatar-dialog` 与 RTC 适配器、配置检查和会话释放。
6. 实现 Tavus 与 Gemini 适配器及测试模式。
7. 完善后台配置、连接检测、日志和使用说明。
8. 完成自动测试、桌面验收和 HTTPS 手机验收。

## 14. 首批交付边界

必须真实联调：

- 阿里 `qwen3-tts-flash`
- 阿里 `qwen3-vl-flash`

具备权限和 RTC 参数后真实联调：

- 阿里 `avatar-dialog`

完成正式适配器和配置检查、允许等待账号后联调：

- Tavus CVI
- Gemini 行为分析

不在本阶段实现：

- 多实例共享实时媒体会话
- 长期保存完整面试录像
- 心理、人格或测谎模型
- 真人顾问人工复核工作流

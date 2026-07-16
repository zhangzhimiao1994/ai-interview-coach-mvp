# 数字人、语音和行为分析接口说明

当前版本已经接入可配置的阿里实时语音识别和非实时语音合成，同时保留明确的浏览器降级：

- 候选人语音识别：阿里实时识别优先；配置或连接失败时显示“浏览器识别降级”。
- 数字人语音：阿里真实语音优先；配置、请求或播放失败时显示“浏览器语音降级”。
- 数字人画面：仍由前端状态化头像、嘴型动画和字幕渲染，真实 Avatar/RTC 尚未接入。
- 行为分析：仍使用本地可观察信号摘要，视觉抽帧服务尚未接入。

## 1. 阿里语音配置和运行时选择

在后台 `AI 配置中心` 新增或编辑阿里服务商时填写：

- `region`：阿里工作区所属地域，例如 `cn-beijing`。
- `workspaceId`：Model Studio 工作区 ID，ASR/TTS 的工作区域名由它和地域共同生成。
- `apiKey`：通用 API Key，可作为语音能力的后备凭据。
- `asrApiKey`：可选的 ASR 专用 API Key；存在时优先于通用 Key。
- `ttsApiKey`：可选的 TTS 专用 API Key；存在时优先于通用 Key。

密钥只在服务端解密和使用，不会返回给浏览器。浏览器的实时音频只发到本站同源 `/ws/asr`，由服务端连接阿里上游。

参考模型是可编辑建议：

- ASR：`qwen3-asr-flash-realtime`
- TTS：`qwen3-tts-instruct-flash`

“推荐参考（`isDefault`）”不参与运行时路由。保存模型后，还必须在相应能力中点击“设为当前使用”，使其成为当前使用（isSelected）模型。每项能力只能有一个当前使用模型；新会话和新 TTS 请求始终读取当时选中的模型。

配置诊断默认只检查本地必填项，不会自动产生付费调用。管理员可在后台主动检查；语音适配器会报告配置/适配器状态，文本能力的 `liveCheck` 才会执行最小真实请求。

## 2. 实时语音识别

1. 浏览器向 `POST /api/speech-recognition/sessions` 提交当前 `sessionId`。
2. 服务端验证会话仍为 `IN_PROGRESS`，解析当前 `SPEECH_TO_TEXT` 模型并签发 60 秒、一次性的同源票据。
3. 浏览器连接返回的 `/ws/asr?ticket=...`，用 AudioWorklet 将麦克风降采样为 16 kHz、单声道 PCM16。
4. 同进程 WebSocket 网关消费票据，只把允许的音频事件转发给阿里，并只把 ready、partial、final、error 事件返回浏览器。

浏览器不会接收阿里 API Key、工作区凭据或上游 WebSocket 地址。票据过期、配置缺失、连接失败或浏览器不支持 AudioWorklet 时，页面会明确进入“浏览器识别降级”；如果浏览器也不支持语音识别，候选人仍可手动输入。

## 3. 数字人语音接口

`POST /api/digital-human/speech`

用途：把当前面试题转换成可播放语音。请求必须属于仍在进行的训练会话，接口受 Basic Auth、会话校验和每会话限流保护。

请求示例：

```json
{
  "sessionId": "session-1",
  "questionId": "FORMAL_INTERVIEW-0",
  "text": "请先用一分钟介绍你自己，并说明为什么关注这个岗位。",
  "voice": "Cherry",
  "language": "zh-CN",
  "speed": 0.95,
  "expression": "neutral"
}
```

阿里成功返回：

```json
{
  "mode": "ALIBABA_TTS",
  "providerCapability": "TEXT_TO_SPEECH",
  "provider": "alibaba",
  "model": "qwen3-tts-instruct-flash",
  "fallbackUsed": false,
  "speech": {
    "text": "请先用一分钟介绍你自己，并说明为什么关注这个岗位。",
    "language": "zh-CN",
    "voice": "Cherry",
    "speed": 0.95,
    "audioUrl": "https://example.aliyuncs.com/signed-audio.wav",
    "mimeType": "audio/wav",
    "expiresAt": "2026-07-17T00:00:00Z"
  }
}
```

供应商请求失败并成功记录失败日志后，接口返回显式降级：

```json
{
  "mode": "BROWSER_TTS_FALLBACK",
  "providerCapability": "TEXT_TO_SPEECH",
  "fallbackUsed": true,
  "reasonCode": "TTS_UNAVAILABLE",
  "speech": {
    "text": "请先用一分钟介绍你自己，并说明为什么关注这个岗位。",
    "language": "zh-CN",
    "voice": "browser-default",
    "speed": 0.95,
    "audioUrl": null
  }
}
```

前端只保留一个 `<audio>` 实例。快速重播、切题和卸载都会取消旧请求、停止旧音频并回收 Object URL；供应商音频与 `speechSynthesis` 不会同时播放。若浏览器阻止异步音频自动播放，已生成的真实音频会保留，用户可再次点击“播放问题”。

## 4. 数字人渲染接口

`POST /api/digital-human/render`

用途：根据面试官文本、头像和表情状态生成数字人画面。当前返回前端渲染 fallback；未来接入 HeyGen、D-ID、腾讯智影、MiniMax 视频、Live2D 或自研 WebRTC 流。

请求示例：

```json
{
  "text": "你刚才提到了增长指标，请补充具体数字。",
  "avatarId": "interviewer-default",
  "expression": "probing",
  "stage": "PRESSURE_FOLLOW_UP"
}
```

当前返回：

```json
{
  "mode": "CLIENT_RENDER_FALLBACK",
  "providerCapability": "DIGITAL_HUMAN_VIDEO",
  "render": {
    "avatarId": "interviewer-default",
    "expression": "probing",
    "stage": "PRESSURE_FOLLOW_UP",
    "text": "你刚才提到了增长指标，请补充具体数字。",
    "videoUrl": null,
    "streamUrl": null,
    "instructions": "当前版本由前端状态化头像、嘴型动画和浏览器 TTS 组合渲染；接入真实数字人后在此返回 videoUrl 或 streamUrl。"
  }
}
```

真实服务商接入方式：

1. 后台进入 `AI 配置中心`。
2. 新增数字人服务商。
3. 新增模型，能力类型选择 `数字人视频`。
4. 修改 `app/api/digital-human/render/route.ts`，调用服务商生成视频或实时流。
5. 返回 `videoUrl` 或 `streamUrl`，前端数字人组件优先播放真实视频流。

## 5. 行为分析接口

`POST /api/behavior-analysis`

用途：把面试过程中的可观察行为信号整理成摘要。当前只做本地规则总结；未来可以接入视觉模型、音频模型或专门的行为分析服务。

请求示例：

```json
{
  "sessionId": "session-1",
  "questionId": "FORMAL_INTERVIEW-1",
  "signals": {
    "answerDurationSeconds": 95,
    "transcriptLength": 80,
    "averageVolume": 42,
    "peakVolume": 78,
    "longPauseCount": 2,
    "cameraEnabled": true,
    "microphoneEnabled": true,
    "speechRecognitionUsed": true
  }
}
```

当前返回：

```json
{
  "mode": "LOCAL_SIGNAL_SUMMARY",
  "providerCapability": "VISION_BEHAVIOR_ANALYSIS",
  "sessionId": "session-1",
  "questionId": "FORMAL_INTERVIEW-1",
  "summary": {
    "observations": [
      "回答中记录到 2 次长停顿。",
      "本题回答时长约 95 秒。",
      "平均音量约 42%，峰值约 78%。"
    ],
    "risks": [
      "长停顿可能影响表达稳定性判断"
    ],
    "coachingTips": [
      "练习先给结论，再用 2-3 个证据展开，减少临场组织压力。"
    ]
  }
}
```

真实服务商接入方式：

1. 后台进入 `AI 配置中心`。
2. 新增视觉或多模态服务商。
3. 新增模型，能力类型选择 `神态/行为分析`。
4. 修改 `app/api/behavior-analysis/route.ts`，把浏览器采集信号、视频帧摘要或音频特征发送给模型。
5. 返回结构仍保持 `observations`、`risks`、`coachingTips`，报告层不用重写。

## 6. 面试流程如何使用

练习室里每次提交回答时，前端会把下面内容一起发送到：

`POST /api/sessions/:sessionId/answer`

核心字段：

```json
{
  "questionId": "FORMAL_INTERVIEW-0",
  "stage": "FORMAL_INTERVIEW",
  "question": "请结合过往经历说明你如何胜任目标岗位。",
  "answer": "我的回答是……",
  "behaviorSignals": {
    "answerDurationSeconds": 88,
    "transcriptLength": 120,
    "averageVolume": 38,
    "peakVolume": 74,
    "longPauseCount": 1,
    "cameraEnabled": true,
    "microphoneEnabled": true,
    "speechRecognitionUsed": true
  }
}
```

后端会把 `behaviorSignals` 存到 `SessionTurn.behaviorSignalsJson`。完成面试时，`POST /api/sessions/:sessionId/complete` 会把每题回答和行为信号一起交给报告模型。

报告中只允许写可观察行为影响，例如：

```text
第 2 题回答中记录到 2 次长停顿，可能影响面试官对表达稳定性的判断。
```

禁止写心理或人格诊断，例如：

```text
候选人性格不自信。
```

## 7. 当前可用能力

- 电脑和手机浏览器都可以打开练习页。
- 通过 HTTPS 或 localhost 时，浏览器可以请求摄像头和麦克风权限。
- 配置并选中阿里 ASR 模型后，候选人可以使用同源 WebSocket 实时转写。
- 配置并选中阿里 TTS 模型后，数字人面试官可以播放真实供应商音频。
- ASR/TTS 失败会显示浏览器识别降级或浏览器语音降级，不会冒充阿里成功。
- 候选人回答时会采集音量、长停顿、回答时长、摄像头/麦克风状态。
- 报告可以展示行为信号证据。

仍未接入的能力：阿里 Avatar/RTC 数字人视频、摄像头抽帧视觉行为分析，以及视觉证据写入报告。这些接口继续返回明确 fallback，不能描述为真实服务已经可用。


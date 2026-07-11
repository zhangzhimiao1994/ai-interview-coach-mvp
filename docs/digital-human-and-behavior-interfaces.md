# 数字人、语音和行为分析接口说明

当前版本先保证本地可演示、手机和电脑浏览器可用：

- 数字人语音：前端使用浏览器 `speechSynthesis` 朗读问题。
- 数字人画面：前端使用状态化头像、嘴型动画和字幕渲染。
- 行为分析：前端采集麦克风音量、长停顿、回答时长、摄像头/麦克风状态和语音识别状态，后端生成可解释摘要。

后续接入真实服务商时，不需要改面试主流程，主要替换下面三个接口内部实现。

## 1. 数字人语音接口

`POST /api/digital-human/speech`

用途：把面试官文本转换成语音。当前返回浏览器 TTS fallback；未来接入 MiniMax、OpenAI、通义、火山等 TTS 后返回 `audioUrl`。

请求示例：

```json
{
  "text": "请先用一分钟介绍你自己，并说明为什么关注这个岗位。",
  "voice": "professional-female",
  "language": "zh-CN",
  "speed": 1
}
```

当前返回：

```json
{
  "mode": "BROWSER_TTS_FALLBACK",
  "providerCapability": "TEXT_TO_SPEECH",
  "speech": {
    "text": "请先用一分钟介绍你自己，并说明为什么关注这个岗位。",
    "language": "zh-CN",
    "voice": "professional-female",
    "speed": 1,
    "audioUrl": null,
    "instructions": "当前版本由前端使用浏览器 speechSynthesis 朗读；接入真实 TTS 后在此返回 audioUrl。"
  }
}
```

真实服务商接入方式：

1. 后台进入 `AI 配置中心`。
2. 新增服务商，例如 MiniMax、OpenAI、通义、火山。
3. 新增模型，能力类型选择 `语音合成`。
4. 修改 `app/api/digital-human/speech/route.ts`，读取后台默认 `TEXT_TO_SPEECH` 模型并调用服务商。
5. 返回真实音频地址或 base64 音频，让前端播放。

## 2. 数字人渲染接口

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

## 3. 行为分析接口

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

## 4. 面试流程如何使用

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

## 5. 当前可用能力

- 电脑和手机浏览器都可以打开练习页。
- 通过 HTTPS 或 localhost 时，浏览器可以请求摄像头和麦克风权限。
- 数字人面试官可以用浏览器内置语音朗读问题。
- 候选人回答时会采集音量、长停顿、回答时长、摄像头/麦克风状态。
- 报告可以展示行为信号证据。


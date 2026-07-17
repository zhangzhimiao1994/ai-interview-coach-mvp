# 灵眸 2D 云渲染与 CosyVoice 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将面试官语音切换到百炼 `cosyvoice-v3-flash` / `longanhuan`，接入灵眸 2D 云渲染音频驱动 WebSDK，并在本机尚无灵眸项目和 RAM AccessKey 时提供明确、可测试、不阻断面试的降级链路。

**Architecture:** 百炼 `TONGYI` 服务商只负责 ASR 与 CosyVoice；新增 `LINGMOU` 服务商保存 RAM AccessKey 并通过 `LingMou/2025-05-27` SDK 创建、查询和关闭数字人会话。服务端把 CosyVoice SSE 转换为有界 PCM16 流，把灵眸短期 RTC 入会参数交给浏览器；浏览器按需加载 `lm-avatar-chat-sdk/cloud`，将 48 kHz 单声道 PCM16 按序送入 `pushAudioData()`。数据库只记录会话生命周期，不记录 RTC Token、永久密钥或音频。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Prisma 5 / SQLite、Zod、Vitest、`@alicloud/lingmou20250527@1.8.0`、`@alicloud/openapi-core@1.0.8`、`lm-avatar-chat-sdk@1.1.4`、Docker Compose。

## Global Constraints

- 当前分支固定为 `feature/alibaba-multimodal-integration`，每个 Task 通过测试后单独提交并推送到现有仓库；不新建仓库，不更改 GitHub 项目名称。
- 产品展示名继续使用“开发面试数字人”。
- 不修改或提交根目录用户文件 `new-project-handoff-2026-07-16.md`。
- 不提交 `.env`、`data/`、日志、数据库、API Key、AccessKey、RTC Token 或真实音频。
- 当前只有百炼 API Key，没有灵眸项目 ID、实例 ID 和 RAM AccessKey；所有自动化测试使用注入的假客户端，禁止发起真实灵眸会话或付费诊断。
- `TONGYI` 与 `LINGMOU` 凭据必须分开。百炼 API Key 不能作为 RAM AccessKey 使用，RAM AccessKey 不得进入浏览器、日志或公开 DTO。
- CosyVoice 固定输出 `pcm`、48 kHz、单声道、PCM16 little-endian；默认模型、音色和指令分别为 `cosyvoice-v3-flash`、`longanhuan`、`你说话的情感是 neutral.`。
- 所有数字人接口返回 `Cache-Control: no-store`；二进制语音响应同时返回 `X-Audio-Format: pcm_s16le`、`X-Audio-Sample-Rate: 48000` 和 `X-Audio-Channels: 1`。
- 不保留常驻调试服务。最终 Docker 验证结束后执行 `docker compose down --remove-orphans` 和 `docker desktop stop`，并确认 3000 端口和 Docker 容器均为空。

---

## 文件结构

- `lib/media/providers/alibabaTts.ts`：改为 CosyVoice HTTP/SSE 适配器，保留现有工厂导出以减少调用面。
- `lib/media/types.ts`：增加 PCM 流结果和流式 TTS 接口。
- `lib/media/digitalHumanSpeech.ts`：让旧语音端点兼容 CosyVoice PCM Base64，作为新组件迁移期间的安全兼容层。
- `lib/domain/aiServiceConstants.ts`：增加 `LINGMOU` 服务商类型。
- `components/admin/AiMultimodalConfigFields.tsx`：拆分百炼字段与灵眸 RAM 字段，增加 CosyVoice/灵眸模型设置。
- `components/admin/AiServiceConfigPanel.tsx`：按服务商类型组装独立凭据和设置。
- `lib/domain/aiModelSettings.ts`：保存 CosyVoice 与灵眸模型设置。
- `lib/domain/modelRecommendations.ts`：推荐 CosyVoice 与灵眸音频驱动适配器。
- `lib/db/seedAiModels.ts`、`lib/db/seed.ts`：分别播种百炼媒体模型和灵眸数字人模型。
- `prisma/migrations/20260717090000_use_cosyvoice_lingmou_references/migration.sql`：只迁移未被修改的旧种子引用。
- `lib/media/providers/lingmouCredentials.ts`：解密并校验灵眸服务商与模型配置。
- `lib/media/providers/lingmou.ts`：封装官方 OpenAPI SDK，创建和关闭会话并输出安全 RTC DTO。
- `lib/ai/diagnostics.ts`、`lib/ai/diagnosticTypes.ts`、`components/admin/AiDiagnosticsPanel.tsx`：增加灵眸未配置、本地配置通过和显式真实检查状态。
- `prisma/schema.prisma`、`prisma/migrations/20260717110000_add_digital_human_sessions/migration.sql`：增加不存密钥和 RTC 参数的数字人会话表。
- `lib/domain/trainingQuestions.ts`：复用训练提纲题目归属校验。
- `lib/media/digitalHumanSessions.ts`：实现本地/云端会话状态机、幂等关闭、心跳和空闲清理。
- `app/api/digital-human/sessions/route.ts`：创建云端或本地降级会话。
- `app/api/digital-human/sessions/[sessionId]/speech/route.ts`：输出 CosyVoice PCM 流。
- `app/api/digital-human/sessions/[sessionId]/heartbeat/route.ts`：刷新活动时间。
- `app/api/digital-human/sessions/[sessionId]/route.ts`：幂等停止会话。
- `lib/client/pcm16.ts`：处理网络任意分块边界并生成可播放 WAV。
- `lib/client/lingmouAvatarClient.ts`：按需加载官方 cloud WebSDK。
- `components/practice/DigitalInterviewerVideo.tsx`：接入云端画面、PCM 推送和四级降级。
- `server.ts`、`app/api/sessions/[sessionId]/complete/route.ts`：进程关闭、空闲超时和面试完成时清理云端会话。
- `.env.example`、`docs/linux-deployment.md`：记录两类凭据、灵眸开通前状态、验证和停机方法。

### Task 1: CosyVoice PCM 流适配器与旧端点兼容

**Files:**
- Modify: `lib/media/types.ts`
- Modify: `lib/media/providers/alibabaTts.ts`
- Modify: `lib/media/digitalHumanSpeech.ts`
- Modify: `tests/unit/alibaba-tts.test.ts`
- Modify: `tests/unit/digital-human-interface-routes.test.ts`

**Interfaces:**

```ts
export type SpeechPcmStreamResult = MediaExecutionMetadata & {
  encoding: "pcm_s16le";
  sampleRate: 48000;
  channels: 1;
  chunks: AsyncIterable<Uint8Array>;
};

export interface StreamingTextToSpeechProvider extends TextToSpeechProvider {
  streamPcm(input: SpeechSynthesisInput): Promise<SpeechPcmStreamResult>;
}

export function validateAlibabaHttpTtsModelName(modelName: string): string;
export function buildAlibabaTtsUrl(input: { workspaceId: string; region: string }): string;
export function createAlibabaTtsProvider(
  model: ResolvedMediaModel,
  dependencies?: AlibabaTtsDependencies
): StreamingTextToSpeechProvider;
```

- [ ] **Step 1: 把现有 TTS 单元测试改写成 CosyVoice 失败测试**

在 `tests/unit/alibaba-tts.test.ts` 把测试模型改为：

```ts
modelName: "cosyvoice-v3-flash",
modelSettings: {
  voice: "longanhuan",
  format: "pcm",
  sampleRate: 48000,
  channels: 1,
  instruction: "你说话的情感是 neutral."
}
```

增加覆盖：

```ts
it("uses the workspace-scoped CosyVoice streaming endpoint", async () => {
  const provider = createAlibabaTtsProvider(resolvedTtsModel(), { fetch: fetchMock });
  const result = await provider.streamPcm({ text: "请做自我介绍。" });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://ws-main.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-DashScope-SSE": "enable" })
    })
  );
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
    model: "cosyvoice-v3-flash",
    input: {
      text: "请做自我介绍。",
      voice: "longanhuan",
      format: "pcm",
      sample_rate: 48000,
      rate: 1,
      instruction: "你说话的情感是 neutral."
    }
  });
  await expect(collect(result.chunks)).resolves.toEqual(
    Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0])
  );
});
```

测试 SSE 必须把一个 JSON 事件拆在多个网络块中，并包含 `sentence-begin`、两个 `sentence-synthesis`、`sentence-end` 和最终 `finish_reason: "stop"`。再增加无效 Base64、奇数字节 PCM、单块超过 1 MiB、累计超过 10 MiB、流中断、401、429、503 和超时测试；流已经输出后不得自动重试，以免重复音频。

- [ ] **Step 2: 运行测试并确认旧 Qwen 协议导致失败**

Run: `npx.cmd vitest run tests/unit/alibaba-tts.test.ts`

Expected: FAIL，URL 仍是 `multimodal-generation/generation`，请求体仍包含 `language_type`，且不存在 `streamPcm`。

- [ ] **Step 3: 定义 PCM 流协议并实现有界 SSE 解码**

在 `lib/media/types.ts` 加入本 Task 的接口。在 `lib/media/providers/alibabaTts.ts` 使用以下固定常量和选择校验：

```ts
const COSYVOICE_MODELS = new Set([
  "cosyvoice-v3.5-plus",
  "cosyvoice-v3.5-flash",
  "cosyvoice-v3-plus",
  "cosyvoice-v3-flash",
  "cosyvoice-v2"
]);
const DEFAULT_VOICE = "longanhuan";
const DEFAULT_INSTRUCTION = "你说话的情感是 neutral.";
const PCM_SAMPLE_RATE = 48_000 as const;
const MAX_PCM_CHUNK_BYTES = 1024 * 1024;
const MAX_PCM_TOTAL_BYTES = 10 * 1024 * 1024;

export function validateAlibabaHttpTtsModelName(modelName: string) {
  const normalized = modelName.trim();
  if (!COSYVOICE_MODELS.has(normalized)) {
    throw new MediaConfigurationError(
      "当前语音链路仅支持 CosyVoice HTTP 模型。",
      "ALIBABA_TTS_MODEL_INVALID"
    );
  }
  return normalized;
}
```

`streamPcm()` 先等待上游 HTTP 响应，再返回异步块迭代器。解析器按空行切 SSE 事件，只处理 `output.type === "sentence-synthesis"`，从 `output.audio.data` 读取规范 Base64；严格保持事件顺序。`synthesize()` 复用 `streamPcm()` 聚合数据并返回 `audioBase64`、`mimeType: "audio/pcm"`、`sampleRate: 48000`，不再依赖 24 小时签名 URL。

- [ ] **Step 4: 验证请求、重试、流边界和凭据脱敏**

Run: `npx.cmd vitest run tests/unit/alibaba-tts.test.ts`

Expected: PASS；断言 `ttsApiKey` 优先于主 Key，响应和错误不含测试密钥哨兵。

- [ ] **Step 5: 把旧 `/api/digital-human/speech` 兼容层改为 PCM Base64**

调整 `tests/unit/digital-human-interface-routes.test.ts`：成功响应断言 `audioBase64`、`audio/pcm`、`sampleRate: 48000`，失败仍返回 `BROWSER_TTS_FALLBACK`。`lib/media/digitalHumanSpeech.ts` 继续保留同一路由和日志行为，只替换成功结果的音频位置，不改变会话激活检查和速率限制。

Run: `npx.cmd vitest run tests/unit/digital-human-interface-routes.test.ts`

Expected: PASS。

- [ ] **Step 6: 运行阶段回归、检查并提交推送**

```powershell
npx.cmd vitest run tests/unit/alibaba-tts.test.ts tests/unit/digital-human-interface-routes.test.ts tests/unit/ai-diagnostics.test.ts
npx.cmd tsc --noEmit
git diff --check
git status -sb
git add lib/media/types.ts lib/media/providers/alibabaTts.ts lib/media/digitalHumanSpeech.ts tests/unit/alibaba-tts.test.ts tests/unit/digital-human-interface-routes.test.ts
git commit -m "integrate CosyVoice PCM streaming"
git push origin feature/alibaba-multimodal-integration
```

Expected: 所有定向测试通过、TypeScript exit 0，提交不包含根目录交接文件和任何密钥。

### Task 2: 百炼/灵眸配置拆分、推荐和安全迁移

**Files:**
- Modify: `lib/domain/aiServiceConstants.ts`
- Modify: `components/admin/AiMultimodalConfigFields.tsx`
- Modify: `components/admin/AiServiceConfigPanel.tsx`
- Modify: `lib/domain/aiModelSettings.ts`
- Modify: `lib/domain/modelRecommendations.ts`
- Modify: `lib/db/seedAiModels.ts`
- Modify: `lib/db/seed.ts`
- Create: `prisma/migrations/20260717090000_use_cosyvoice_lingmou_references/migration.sql`
- Modify: `tests/unit/model-recommendations.test.ts`
- Modify: `tests/unit/seed-ai-models.test.ts`
- Create: `tests/unit/lingmou-cosyvoice-reference-migration.test.ts`
- Modify: `tests/unit/ai-service-config-panel-submit.test.tsx`

**Interfaces:**

```ts
export const aiProviderTypes = [
  "MOCK", "OPENAI_COMPATIBLE", "OPENAI", "AZURE_OPENAI", "DEEPSEEK",
  "TONGYI", "LINGMOU", "VOLCANO_ARK", "ZHIPU", "MINIMAX", "TENCENT", "CUSTOM"
] as const;

export function AlibabaProviderFields(): React.JSX.Element;
export function LingmouProviderFields(): React.JSX.Element;
export async function seedAlibabaMediaModels(prisma: SeedAlibabaMediaClient): Promise<void>;
export async function seedLingmouDigitalHumanModels(prisma: SeedLingmouMediaClient): Promise<void>;
```

- [ ] **Step 1: 先写配置、推荐、种子和迁移失败测试**

要求测试断言：

```ts
expect(aiProviderTypes).toContain("LINGMOU");
expect(ttsRecommendation).toMatchObject({
  providerType: "TONGYI",
  modelName: "cosyvoice-v3-flash"
});
expect(digitalHumanRecommendation).toMatchObject({
  providerType: "LINGMOU",
  modelName: "lingmou-2d-cloud-audio-driven"
});
expect(JSON.parse(cosySeed.settingsJson)).toEqual({
  voice: "longanhuan",
  format: "pcm",
  sampleRate: 48000,
  channels: 1,
  instruction: "你说话的情感是 neutral."
});
```

表单测试必须确认 `TONGYI` 只提交 `asrApiKey`、`ttsApiKey`、`workspaceId`、`region`；`LINGMOU` 只提交加密凭据字段 `accessKeyId`、`accessKeySecret` 和设置 `region`，不提交百炼 `apiKey`、Workspace 或旧 RTC App Key。

- [ ] **Step 2: 运行测试并确认缺少 LINGMOU 与新引用**

Run: `npx.cmd vitest run tests/unit/model-recommendations.test.ts tests/unit/seed-ai-models.test.ts tests/unit/ai-service-config-panel-submit.test.tsx tests/unit/lingmou-cosyvoice-reference-migration.test.ts`

Expected: FAIL，现有推荐仍是 Qwen TTS / `avatar-dialog`，且迁移文件不存在。

- [ ] **Step 3: 实现独立管理字段和模型设置**

`LingmouProviderFields` 固定渲染：

```tsx
export function LingmouProviderFields() {
  return (
    <div className="grid gap-4 rounded-md border border-line p-4">
      <h3 className="text-sm font-medium text-ink">灵眸 RAM 凭据</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField label="地域" name="region" defaultValue="cn-beijing" />
        <ConfigField label="AccessKey ID" name="accessKeyId" type="password" />
        <ConfigField label="AccessKey Secret" name="accessKeySecret" type="password" />
      </div>
    </div>
  );
}
```

`TEXT_TO_SPEECH` 模型设置字段改为 `voice`、`format`、`sampleRate`、`channels`、`instruction`；`DIGITAL_HUMAN_REALTIME` 改为 `configId`、`instanceId`、只读 `renderMode=cloud`、`integrationMode=audio-driven`、`client=web`。`modelSettingsFromForm()` 使用相同字段名和固定默认值。

- [ ] **Step 4: 更新推荐、播种逻辑和更新时间**

百炼种子只包含 ASR、CosyVoice 和行为分析。灵眸种子只在存在已启用 `LINGMOU` 服务商时创建：

```ts
const lingmouReference = {
  seedKey: "digital-human-realtime",
  displayName: "灵眸 2D 云渲染音频驱动数字人",
  modelName: "lingmou-2d-cloud-audio-driven",
  capability: "DIGITAL_HUMAN_REALTIME",
  settings: {
    configId: "",
    instanceId: "",
    renderMode: "cloud",
    integrationMode: "audio-driven",
    client: "web"
  }
} as const;
```

`lib/db/seed.ts` 依次调用 `seedAlibabaMediaModels(prisma)` 和 `seedLingmouDigitalHumanModels(prisma)`。模型推荐更新时间改为 `2026-07-17`。

- [ ] **Step 5: 写只迁移未修改种子记录的 SQLite SQL**

`20260717090000_use_cosyvoice_lingmou_references/migration.sql` 使用完整旧值保护：

```sql
UPDATE "AiModelConfig"
SET
  "displayName" = '阿里百炼 CosyVoice 语音合成',
  "modelName" = 'cosyvoice-v3-flash',
  "settingsJson" = '{"voice":"longanhuan","format":"pcm","sampleRate":48000,"channels":1,"instruction":"你说话的情感是 neutral."}'
WHERE "id" LIKE 'alibaba-media-%-text-to-speech'
  AND "modelName" = 'qwen3-tts-instruct-flash'
  AND "settingsJson" = '{"voice":"Cherry","instructions":"语气专业、自然、清晰。"}';

UPDATE "AiModelConfig"
SET "enabled" = 0, "isDefault" = 0, "isSelected" = 0
WHERE "id" LIKE 'alibaba-media-%-digital-human-realtime'
  AND "modelName" = 'avatar-dialog'
  AND "settingsJson" = '{"avatarId":"","voiceId":"","rtcMode":"web"}';
```

迁移测试使用临时 SQLite，包含未修改种子、用户自定义模型和用户已编辑的种子 ID；只允许第一类变化。

- [ ] **Step 6: 跑阶段测试、全量类型检查并提交推送**

```powershell
npx.cmd vitest run tests/unit/model-recommendations.test.ts tests/unit/seed-ai-models.test.ts tests/unit/ai-service-config-panel-submit.test.tsx tests/unit/lingmou-cosyvoice-reference-migration.test.ts
npx.cmd prisma generate
npx.cmd tsc --noEmit
git diff --check
git add lib/domain/aiServiceConstants.ts components/admin/AiMultimodalConfigFields.tsx components/admin/AiServiceConfigPanel.tsx lib/domain/aiModelSettings.ts lib/domain/modelRecommendations.ts lib/db/seedAiModels.ts lib/db/seed.ts prisma/migrations/20260717090000_use_cosyvoice_lingmou_references/migration.sql tests/unit/model-recommendations.test.ts tests/unit/seed-ai-models.test.ts tests/unit/ai-service-config-panel-submit.test.tsx tests/unit/lingmou-cosyvoice-reference-migration.test.ts
git commit -m "split Lingmou and CosyVoice configuration"
git push origin feature/alibaba-multimodal-integration
```

### Task 3: 灵眸官方 OpenAPI 适配器与配置诊断

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/media/providers/lingmouCredentials.ts`
- Create: `lib/media/providers/lingmou.ts`
- Modify: `lib/ai/diagnosticTypes.ts`
- Modify: `lib/ai/diagnostics.ts`
- Modify: `components/admin/AiDiagnosticsPanel.tsx`
- Create: `tests/unit/lingmou-provider.test.ts`
- Modify: `tests/unit/ai-diagnostics.test.ts`
- Modify: `tests/unit/ai-diagnostics-ui.test.tsx`

**Interfaces:**

```ts
export type LingmouCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  region: "cn-beijing";
  configId: string;
  instanceId: string;
};

export type LingmouRtcConnection = {
  appId: string;
  avatarUserId: string;
  channel: string;
  clientUserId: string;
  serverUserId: string;
  timestamp: number;
  token: string;
  sessionId: string;
};

export interface LingmouProvider {
  createSession(): Promise<{ providerSessionId: string; connection: LingmouRtcConnection }>;
  closeSession(providerSessionId: string): Promise<void>;
}

export function resolveLingmouCredentials(
  model: ResolvedMediaModel,
  readConfigSecret?: () => string
): LingmouCredentials;
export function createLingmouProvider(
  model: ResolvedMediaModel,
  dependencies?: LingmouDependencies
): LingmouProvider;
```

- [ ] **Step 1: 安装并锁定官方服务端 SDK**

Run: `npm.cmd install @alicloud/lingmou20250527@1.8.0 @alicloud/openapi-core@1.0.8`

Expected: `package.json` 和 `package-lock.json` 同步，未运行服务。

- [ ] **Step 2: 先写凭据、DTO 映射、关闭和脱敏失败测试**

`tests/unit/lingmou-provider.test.ts` 注入假 SDK 客户端，覆盖：

- 服务商类型不是 `LINGMOU`；
- AccessKey ID/Secret、`configId`、`instanceId` 或地域缺失；
- `createChatSession(configId, new CreateChatSessionRequest({ instanceId }))` 的调用；
- 响应缺少任一 WebSDK 必填 RTC 字段；
- DTO 只包含本 Task 接口列出的短期字段，不含 `gslb`、`nonce`、AccessKey 或 SDK 原始响应；
- `closeChatInstanceSessions(instanceId, { sessionIds: [providerSessionId] })`；
- 重复关闭由上层幂等控制，适配器一次调用一次 SDK；
- SDK 异常映射为 `LINGMOU_AUTH_FAILED`、`LINGMOU_CONFIG_NOT_FOUND`、`LINGMOU_INSTANCE_UNAVAILABLE` 或 `LINGMOU_UPSTREAM_FAILED`，不拼接原始异常消息。

- [ ] **Step 3: 运行测试并确认模块不存在**

Run: `npx.cmd vitest run tests/unit/lingmou-provider.test.ts`

Expected: FAIL，无法解析 `lingmouCredentials` / `lingmou`。

- [ ] **Step 4: 实现官方 SDK 工厂和窄客户端边界**

生产工厂使用官方类型：

```ts
import LingMouClient, {
  CloseChatInstanceSessionsRequest,
  CreateChatSessionRequest
} from "@alicloud/lingmou20250527";
import { $OpenApiUtil } from "@alicloud/openapi-core";

function createSdkClient(credentials: LingmouCredentials) {
  return new LingMouClient(new $OpenApiUtil.Config({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    regionId: credentials.region
  }));
}
```

内部依赖接口只暴露 `createChatSession()` 和 `closeChatInstanceSessions()`，测试不加载网络。`createSession()` 校验 `response.body.success`、`body.data.sessionId` 及 WebSDK 必填字段后构造新对象；禁止展开原始 `rtcParams`。

- [ ] **Step 5: 先写灵眸诊断状态失败测试**

扩展诊断状态：

```ts
export const aiDiagnosticStatuses = [
  "AVAILABLE", "CONFIG_VALID", "CONFIGURED_NOT_ADAPTED", "NOT_SELECTED",
  "NOT_CONFIGURED", "LIVE_AVAILABLE", "LIVE_FAILED",
  "MISCONFIGURED", "UNREACHABLE"
] as const;
```

测试 `DIGITAL_HUMAN_REALTIME`：无所选灵眸模型、错选 `TONGYI`、缺 AccessKey、缺 config/instance 均返回 `NOT_CONFIGURED`；字段完整且 `liveCheck: false` 返回 `CONFIG_VALID` 并且不调用 SDK；`liveCheck: true` 在本 Task 暂时返回 `CONFIG_VALID` / `LIVE_CHECK_REQUIRES_EXPLICIT_SESSION`，真实创建关闭放到 Task 6。

- [ ] **Step 6: 实现无付费配置诊断和 UI 警示**

`requiredConfiguration()` 将 `LINGMOU + DIGITAL_HUMAN_REALTIME` 视为托管适配器，不要求 Base URL 或主 API Key，只校验结构化 AccessKey、`region=cn-beijing`、`configId`、`instanceId` 和固定适配器设置。诊断面板显示“灵眸未配置，当前使用本地数字人”，并把真实检查按钮标为“真实检查（可能计费）”。

Run: `npx.cmd vitest run tests/unit/lingmou-provider.test.ts tests/unit/ai-diagnostics.test.ts tests/unit/ai-diagnostics-ui.test.tsx`

Expected: PASS；测试序列化结果不含密钥哨兵。

- [ ] **Step 7: 类型检查、依赖审计、提交并推送**

```powershell
npx.cmd tsc --noEmit
npm.cmd audit --omit=dev
git diff --check
git add package.json package-lock.json lib/media/providers/lingmouCredentials.ts lib/media/providers/lingmou.ts lib/ai/diagnosticTypes.ts lib/ai/diagnostics.ts components/admin/AiDiagnosticsPanel.tsx tests/unit/lingmou-provider.test.ts tests/unit/ai-diagnostics.test.ts tests/unit/ai-diagnostics-ui.test.tsx
git commit -m "add Lingmou OpenAPI adapter"
git push origin feature/alibaba-multimodal-integration
```

`npm audit` 若报告现有不可修复项，记录包名、严重级别和上游状态；不得运行会引入破坏性主版本的 `npm audit fix --force`。

### Task 4: 数字人会话存储、状态机与同源 API

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260717110000_add_digital_human_sessions/migration.sql`
- Create: `lib/domain/trainingQuestions.ts`
- Modify: `app/api/sessions/[sessionId]/answer/route.ts`
- Create: `lib/media/digitalHumanSessions.ts`
- Create: `app/api/digital-human/sessions/route.ts`
- Create: `app/api/digital-human/sessions/[sessionId]/speech/route.ts`
- Create: `app/api/digital-human/sessions/[sessionId]/heartbeat/route.ts`
- Create: `app/api/digital-human/sessions/[sessionId]/route.ts`
- Create: `tests/unit/digital-human-session-migration.test.ts`
- Create: `tests/unit/digital-human-sessions.test.ts`
- Create: `tests/unit/digital-human-session-routes.test.ts`

**Interfaces:**

```ts
export const digitalHumanSessionStatuses = [
  "CONNECTING", "READY", "SPEAKING", "STOPPING", "STOPPED", "FAILED"
] as const;
export type DigitalHumanSessionStatus = (typeof digitalHumanSessionStatuses)[number];

export type PublicDigitalHumanSession = {
  id: string;
  mode: "LINGMOU_CLOUD" | "LOCAL_AVATAR";
  status: "READY";
  reasonCode: string | null;
  connection: LingmouRtcConnection | null;
  expiresAt: string;
};

export async function createDigitalHumanSession(trainingSessionId: string): Promise<PublicDigitalHumanSession>;
export async function heartbeatDigitalHumanSession(id: string): Promise<void>;
export async function stopDigitalHumanSession(id: string, reason: string): Promise<void>;
export async function stopDigitalHumanSessionsForTrainingSession(trainingSessionId: string, reason: string): Promise<void>;
export async function stopIdleDigitalHumanSessions(now?: Date): Promise<number>;
export async function failUnrecoverableDigitalHumanSessions(now?: Date): Promise<number>;
```

- [ ] **Step 1: 先写迁移和状态机失败测试**

Prisma 模型固定为：

```prisma
model DigitalHumanSession {
  id                String          @id @default(cuid())
  trainingSessionId String
  trainingSession   TrainingSession @relation(fields: [trainingSessionId], references: [id], onDelete: Cascade)
  providerId        String?
  modelId           String?
  adapter           String
  mode              String
  providerSessionId String?
  instanceId        String?
  status            String          @default("CONNECTING")
  lastActivityAt    DateTime        @default(now())
  expiresAt         DateTime
  endedAt           DateTime?
  stopReason        String?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@index([trainingSessionId])
  @@index([status, lastActivityAt])
  @@index([providerSessionId])
}
```

迁移测试用临时 SQLite 验证外键、索引以及表中不存在 `token`、`accessKey`、`rtcParams`、`audio` 列。状态机测试覆盖合法迁移、非法回退、云端创建成功后数据库写入失败的补偿关闭、本地降级、幂等停止和停止失败转 `FAILED`。

- [ ] **Step 2: 运行测试并确认表和服务不存在**

Run: `npx.cmd vitest run tests/unit/digital-human-session-migration.test.ts tests/unit/digital-human-sessions.test.ts`

Expected: FAIL。

- [ ] **Step 3: 提取题目归属校验并保持回答路由行为**

从 `app/api/sessions/[sessionId]/answer/route.ts` 提取：

```ts
export function parseSavedOutline(outlineJson: string | null): TrainingOutline | null;
export function resolveSessionQuestion(
  outline: TrainingOutline,
  questionId: string,
  turns: Array<{ questionId: string | null; stage: string; feedback: string | null }>
): TrainingQuestion | null;
```

回答路由和数字人 speech 路由共用该函数；普通题必须出现在 outline，`::follow-up::1` 必须有已保存的父题 turn。先跑 `tests/unit/session-api.test.ts`，确保原行为不变。

- [ ] **Step 4: 实现持久化状态机与本地降级创建**

创建流程固定为：验证训练会话 `IN_PROGRESS` → 关闭该训练会话遗留的非终态数字人会话 → 尝试解析所选灵眸模型 → 缺配置时创建 `LOCAL_AVATAR/READY` 记录 → 配置完整时先写 `CONNECTING` → 调官方适配器 → 更新 `LINGMOU_CLOUD/READY`。云端创建成功而数据库更新失败时必须在 catch 中调用关闭补偿。

`expiresAt` 为创建后 15 分钟，心跳每 20 秒刷新 `lastActivityAt`，空闲 60 秒由 Task 6 清理。任何返回 DTO 都从白名单字段构造，数据库不保存 `connection`。

- [ ] **Step 5: 先写四个 API 的失败测试**

路由协议固定为：

```ts
POST /api/digital-human/sessions
body: { "trainingSessionId": "session-1" }
response: { "session": PublicDigitalHumanSession }

POST /api/digital-human/sessions/{digitalHumanSessionId}/speech
body: { "questionId": "FORMAL_INTERVIEW-1", "text": "请介绍项目经验。", "speed": 0.95 }
success: binary PCM16 response
fallback: 503 { "mode": "BROWSER_TTS_FALLBACK", "reasonCode": "TTS_UNAVAILABLE" }

POST /api/digital-human/sessions/{digitalHumanSessionId}/heartbeat
response: { "ok": true }

DELETE /api/digital-human/sessions/{digitalHumanSessionId}
response: { "ok": true }
```

测试覆盖 400、404、409、429、题目不归属、已结束训练会话、重复 DELETE、`Cache-Control: no-store`、PCM 响应头、没有 RTC/AccessKey 泄露和 TTS 调用日志。

- [ ] **Step 6: 实现薄路由与可取消流桥接**

speech 路由从数字人记录取得 `trainingSessionId`，验证题目后调用 CosyVoice `streamPcm()`。用 `ReadableStream<Uint8Array>` 驱动异步迭代器；`cancel()` 调用迭代器 `return()`，防止客户端离开后继续拉取付费音频。流完成时把状态从 `SPEAKING` 恢复为 `READY` 并记成功日志；失败时恢复 `READY`、记安全错误码并关闭流。

成功响应头：

```ts
{
  "Content-Type": "audio/pcm",
  "Cache-Control": "no-store",
  "X-Audio-Format": "pcm_s16le",
  "X-Audio-Sample-Rate": "48000",
  "X-Audio-Channels": "1"
}
```

- [ ] **Step 7: 跑迁移、状态机、路由和回归测试并提交推送**

```powershell
npx.cmd prisma generate
npx.cmd vitest run tests/unit/digital-human-session-migration.test.ts tests/unit/digital-human-sessions.test.ts tests/unit/digital-human-session-routes.test.ts tests/unit/session-api.test.ts tests/unit/digital-human-interface-routes.test.ts
npx.cmd tsc --noEmit
git diff --check
git add prisma/schema.prisma prisma/migrations/20260717110000_add_digital_human_sessions/migration.sql lib/domain/trainingQuestions.ts app/api/sessions/[sessionId]/answer/route.ts lib/media/digitalHumanSessions.ts app/api/digital-human/sessions/route.ts app/api/digital-human/sessions/[sessionId]/speech/route.ts app/api/digital-human/sessions/[sessionId]/heartbeat/route.ts app/api/digital-human/sessions/[sessionId]/route.ts tests/unit/digital-human-session-migration.test.ts tests/unit/digital-human-sessions.test.ts tests/unit/digital-human-session-routes.test.ts
git commit -m "add digital human session lifecycle APIs"
git push origin feature/alibaba-multimodal-integration
```

### Task 5: 灵眸 WebSDK、PCM 边界处理与面试房间降级

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/client/pcm16.ts`
- Create: `lib/client/lingmouAvatarClient.ts`
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Modify: `tests/unit/digital-interviewer-video.test.tsx`
- Create: `tests/unit/pcm16-stream.test.ts`
- Create: `tests/unit/lingmou-avatar-client.test.ts`

**Interfaces:**

```ts
export class Pcm16LeDecoder {
  push(chunk: Uint8Array): Int16Array;
  finish(): void;
}
export function pcm16LeToWavBlob(bytes: Uint8Array, sampleRate?: 48000): Blob;

export interface LingmouAvatarClient {
  start(connection: LingmouRtcConnection, root: HTMLElement): Promise<void>;
  pushPcm(audio: Int16Array, end: boolean): void;
  interrupt(): void;
  exit(): void;
}
export async function createLingmouAvatarClient(): Promise<LingmouAvatarClient>;
```

- [ ] **Step 1: 安装并锁定官方 WebSDK**

Run: `npm.cmd install lm-avatar-chat-sdk@1.1.4`

Expected: lockfile 同步；生产首屏包不静态引入 SDK。

- [ ] **Step 2: 先写 PCM 与 SDK 封装失败测试**

`Pcm16LeDecoder` 测试把一个 16 位样本拆成两次网络输入，确认按 little-endian 还原；`finish()` 遇到残留单字节必须抛安全错误。WAV 测试确认 RIFF/WAVE、单声道、16 bit、48000 Hz 和数据长度。

SDK 测试 mock 动态 import，断言：

```ts
expect(CloudAvatar).toHaveBeenCalledWith(expect.objectContaining({
  ignoreAudioInput: true,
  rootContainer: root
}));
expect(avatar.start).toHaveBeenCalledWith({
  mode: TYVoiceChatMode.tap2talk,
  keepAlive: true,
  avatarAudioFormat: IAvatarAudioFormat.s16,
  outboundSampleRate: 48000
});
```

同时验证 `interrupt()`、`exit()` 幂等，且浏览器封装不访问 `navigator.mediaDevices`。

- [ ] **Step 3: 实现动态 WebSDK 封装**

`lib/client/lingmouAvatarClient.ts` 内部才执行：

```ts
const sdk = await import("lm-avatar-chat-sdk/cloud");
const avatar = new sdk.CloudAvatar({
  appId: connection.appId,
  channel: connection.channel,
  timestamp: connection.timestamp,
  token: connection.token,
  clientUserId: connection.clientUserId,
  serverUserId: connection.serverUserId,
  avatarUserId: connection.avatarUserId,
  sessionId: connection.sessionId,
  rootContainer: root,
  ignoreAudioInput: true
});
await avatar.start({
  mode: sdk.TYVoiceChatMode.tap2talk,
  keepAlive: true,
  avatarAudioFormat: sdk.IAvatarAudioFormat.s16,
  outboundSampleRate: 48000
});
```

- [ ] **Step 4: 先改写面试官组件失败测试**

测试四级行为：

1. session API 返回 `LINGMOU_CLOUD`：创建 SDK，speech 二进制块通过一个块前瞻依次调用 `pushPcm(previous, false)`，最后调用 `pushPcm(last, true)`，不让隐藏 `<audio>` 同时播放。
2. session API 返回 `LOCAL_AVATAR`：完整读取 PCM，包装 WAV Blob 后使用现有 `<audio>` 播放，本地嘴型动画保持工作。
3. speech 返回 `BROWSER_TTS_FALLBACK`：调用浏览器 `speechSynthesis`。
4. 浏览器也不支持：保持题目文字，显示“语音不可用，请阅读题目”，不抛异常。

再覆盖切题中断旧 fetch/SDK、重复 questionId 不自动重复播报、重播显式允许、心跳、卸载 `exit()` 和 `DELETE keepalive`。

- [ ] **Step 5: 重构组件为会话驱动状态**

组件挂载且存在训练 `sessionId` 时创建数字人会话；候场预览不创建。灵眸 SDK 的 `rootContainer` 使用稳定 `ref` 容器，由 SDK 创建内部视频节点；本地头像作为兄弟层，仅在云端未首帧或降级时显示。

播放流程固定为：停止上一代输出 → POST 新 speech 路由 → 按 `mode` 选择 SDK 推送或 WAV 播放 → 失败才进入浏览器 TTS。每次切题和卸载递增现有 playback generation，迟到的网络错误不得覆盖新问题状态。

UI 文案改为“灵眸真实数字人 / 本地数字人降级”“CosyVoice / 浏览器语音降级”，保留“AI 生成数字人”标识。

- [ ] **Step 6: 跑浏览器逻辑、组件和现有面试房间回归**

```powershell
npx.cmd vitest run tests/unit/pcm16-stream.test.ts tests/unit/lingmou-avatar-client.test.ts tests/unit/digital-interviewer-video.test.tsx tests/unit/practice-api-error-message.test.ts
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: PASS；Next 构建成功，服务器渲染阶段不执行 `window` 或加载 WebSDK。

- [ ] **Step 7: 检查客户端包和密钥边界，提交并推送**

```powershell
rg -n "accessKeySecret|ttsApiKey|apiKeyCiphertext|credentialsCiphertext" components lib/client app/api/digital-human
git diff --check
git add package.json package-lock.json lib/client/pcm16.ts lib/client/lingmouAvatarClient.ts components/practice/DigitalInterviewerVideo.tsx tests/unit/digital-interviewer-video.test.tsx tests/unit/pcm16-stream.test.ts tests/unit/lingmou-avatar-client.test.ts
git commit -m "drive Lingmou avatar with CosyVoice PCM"
git push origin feature/alibaba-multimodal-integration
```

Expected: `rg` 命中只允许出现在服务端路由导入或测试断言，不允许永久凭据出现在 `components/` 或 `lib/client/`。

### Task 6: 清理、显式真实诊断、文档和 Docker 同步验收

**Files:**
- Modify: `server.ts`
- Modify: `app/api/sessions/[sessionId]/complete/route.ts`
- Modify: `lib/media/digitalHumanSessions.ts`
- Modify: `lib/ai/diagnostics.ts`
- Modify: `components/admin/AiDiagnosticsPanel.tsx`
- Modify: `.env.example`
- Modify: `docs/linux-deployment.md`
- Modify: `tests/unit/realtime-upgrade-router.test.ts`
- Modify: `tests/unit/session-api.test.ts`
- Modify: `tests/unit/ai-diagnostics.test.ts`
- Modify: `tests/unit/ai-diagnostics-ui.test.tsx`
- Modify: `tests/unit/linux-deployment-package.test.ts`

**Interfaces:**

```ts
export function startDigitalHumanSessionReaper(options?: {
  intervalMs?: number;
  now?: () => Date;
}): () => void;

export async function probeLingmouModel(model: ResolvedMediaModel): Promise<{
  ok: boolean;
  code: string;
  message: string;
}>;
```

- [ ] **Step 1: 先写进程、完成路由和诊断清理失败测试**

覆盖：启动时把遗留 `CONNECTING/READY/SPEAKING/STOPPING` 标记为 `FAILED`，每 30 秒清理 60 秒无心跳的云端会话，SIGINT/SIGTERM 先停止 reaper 再尝试关闭全部云端会话；训练完成事务成功后关闭该训练会话的数字人，报告生成失败时不提前关闭。

显式 `liveCheck: true` 测试注入 `probeLingmouModel`，确认成功返回 `LIVE_AVAILABLE`，创建后立即关闭；创建失败或关闭失败返回 `LIVE_FAILED` 和安全 code。无完整配置时不调用 probe。

- [ ] **Step 2: 实现服务器生命周期清理**

`server.ts` 在 `app.prepare()` 后、监听前执行一次恢复标记并启动 reaper。`shutdown()` 的顺序为：停止 reaper → 关闭 WebSocket 客户端 → 停止接受 HTTP → `stopAllActiveDigitalHumanSessions("SERVER_SHUTDOWN")` → `app.close()`。清理失败只记录固定错误码，不打印 SDK 原始异常或凭据。

训练完成路由在数据库事务和 AI 调用日志成功后调用 `stopDigitalHumanSessionsForTrainingSession(session.id, "TRAINING_COMPLETED")`；该清理失败不回滚已经生成的报告，但写安全告警。

- [ ] **Step 3: 实现管理员明确触发的付费诊断**

`probeLingmouModel()` 只由诊断 POST 的 `liveCheck: true` 调用：创建一个会话，校验 RTC DTO，在 `finally` 中立即关闭。UI 必须在按钮旁显示“会创建并立即关闭一次真实会话，可能计费”；本机缺配置时按钮禁用，状态为 `NOT_CONFIGURED`。

当前自动化和最终 Docker 健康验证只执行 `GET` 配置摘要，不执行该 POST。

- [ ] **Step 4: 更新环境和部署文档**

`.env.example` 只保留服务运行级变量，不增加真实灵眸密钥；说明 RAM AccessKey 应从后台加密保存。`docs/linux-deployment.md` 增加：

- 百炼 Workspace/API Key 与灵眸 RAM AccessKey 是两套凭据；
- 创建灵眸项目、购买 2D 对话实例后才填写 `configId` / `instanceId`；
- 当前未开通时预期 `NOT_CONFIGURED`，本地数字人和 CosyVoice 可工作；
- 真实检查可能计费且会立即关闭；
- 更新源码、`npm ci`、Prisma deploy、构建和 Docker 同步命令；
- Docker 测试完必须 down 并停止 Docker Desktop。

- [ ] **Step 5: 跑全部自动化、类型和生产构建**

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd prisma migrate deploy
git diff --check
git status -sb
```

Expected: 所有测试文件和测试项通过；TypeScript exit 0；Next 生产构建包含四个 session 路由；本机数据库迁移成功；状态中不出现 `.env`、数据库或交接文件被 staged。

- [ ] **Step 6: 在无付费调用配置下同步验证 Docker**

```powershell
docker compose config
docker compose build interview-coach
docker compose up -d interview-coach
docker compose ps
curl.exe -f http://127.0.0.1:3000/api/health
docker compose down --remove-orphans
docker ps -a --filter "name=interview-coach"
docker desktop stop
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
```

Expected: Compose 配置有效，镜像从当前工作树完成 Prisma generate 与 Next build，健康接口 200；down 后无项目容器，Docker Desktop 停止，3000 端口没有监听。不得调用灵眸真实检查或 speech 路由。

- [ ] **Step 7: 最终安全与设计复核**

```powershell
rg -n "qwen3-tts|avatar-dialog|rtcAppKey|rtcAppId" app components lib prisma tests docs -g "!docs/superpowers/plans/2026-07-15-alibaba-realtime-digital-human.md"
rg -n "accessKeySecret|apiKeyCiphertext|credentialsCiphertext|token" components lib/client
git diff --check
git status -sb
```

确认：运行时没有旧推荐；历史计划可以保留但不被执行；前端无永久密钥；数据库 migration 没有 Token/音频列；本地状态不冒充 `LIVE_AVAILABLE`；Docker 已关闭。

- [ ] **Step 8: 提交最终阶段并推送**

```powershell
git add server.ts app/api/sessions/[sessionId]/complete/route.ts lib/media/digitalHumanSessions.ts lib/ai/diagnostics.ts components/admin/AiDiagnosticsPanel.tsx .env.example docs/linux-deployment.md tests/unit/realtime-upgrade-router.test.ts tests/unit/session-api.test.ts tests/unit/ai-diagnostics.test.ts tests/unit/ai-diagnostics-ui.test.tsx tests/unit/linux-deployment-package.test.ts
git commit -m "complete Lingmou lifecycle and Docker sync"
git push origin feature/alibaba-multimodal-integration
git status -sb
```

Expected: 推送成功，分支与远端同步；工作区最多只剩用户自有的未跟踪交接文件。

## 计划完成后的真实联调清单

该清单只有在用户取得灵眸项目 ID、实例 ID 和 RAM AccessKey 后执行，不属于当前无凭据自动验收：

- [ ] 在后台新增 `LINGMOU` 服务商，保存最小权限 RAM AccessKey。
- [ ] 新增并选中 `lingmou-2d-cloud-audio-driven`，填写真实 `configId` 和 `instanceId`。
- [ ] 管理员确认可能计费后执行一次真实检查，确认状态 `LIVE_AVAILABLE` 且会话立即关闭。
- [ ] 进入一场短测试面试，确认收到首帧、`longanhuan` 声音、口型同步和候选人麦克风仍由现有 ASR 独立使用。
- [ ] 切题、重播、退出房间和完成面试，确认没有重叠语音或遗留活跃灵眸会话。
- [ ] 联调后停止源码调试进程、执行 Compose down，并关闭 Docker Desktop。

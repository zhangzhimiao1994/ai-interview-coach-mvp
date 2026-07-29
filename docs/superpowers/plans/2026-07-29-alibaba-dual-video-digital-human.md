# Alibaba Dual Video Digital Human Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DUIX runtime with Alibaba Lingmou broadcast video plus Bailian EMO, support preset-question pre-generation and an 8-second dual-provider race for dynamic follow-ups, and preserve uninterrupted local-avatar plus Qwen emotional-TTS fallback.

**Architecture:** Keep the existing interview engine as the source of question text and TTS style. Add encrypted OSS configuration, reusable interviewer profiles, persistent render jobs/attempts/assets, provider-specific asynchronous adapters, and a database-backed orchestration service. The browser only polls project-owned APIs; provider credentials, signed input URLs, and raw provider responses remain server-side.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma/SQLite, Vitest, Alibaba Cloud Lingmou SDK, DashScope EMO HTTP API, `ali-oss`, Docker Compose.

---

## Non-negotiable delivery rules

- Do not add a runtime mock provider, fake success response, or development-only provider bypass.
- New automated provider tests verify deterministic request construction and response parsing without claiming live reachability. Live reachability is only reported after an administrator explicitly runs the paid diagnostic with real credentials.
- Do not place Alibaba keys, OSS credentials, signed URLs, source audio, or unredacted upstream responses in logs, browser storage, fixtures, snapshots, or commits.
- Run the focused tests listed in each task, then `npm.cmd test`, `npm.cmd run build`, and `git diff --check` before that task's commit.
- Commit and push every completed task to `origin feature/alibaba-multimodal-integration`.
- When a task uses Docker, build from the same committed source, run the health check, then execute:

```powershell
docker compose down --remove-orphans
docker desktop stop
```

- Keep the untracked repository-root `new-project-handoff-2026-07-16.md` out of every commit.

## Task 1: Persist video runtime, storage, profiles, jobs, attempts, and assets

**Files:**

- Create: `prisma/migrations/20260729130000_add_alibaba_video_digital_human/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `lib/media/video/types.ts`
- Create: `lib/media/video/settings.ts`
- Create: `lib/validators/digitalHumanVideo.ts`
- Test: `tests/unit/alibaba-video-schema.test.ts`
- Test: `tests/unit/digital-human-video-settings.test.ts`

- [ ] **Step 1: Write the schema contract tests**

Assert that the Prisma schema and migration contain:

```ts
const requiredModels = [
  "MediaStorageConfig",
  "InterviewerAvatarProfile",
  "DigitalHumanMediaAsset",
  "DigitalHumanRenderJob",
  "DigitalHumanRenderAttempt",
];

for (const model of requiredModels) {
  expect(schema).toContain(`model ${model}`);
  expect(migration).toContain(`CREATE TABLE "${model}"`);
}

expect(migration).toContain(
  'CREATE UNIQUE INDEX "DigitalHumanRenderAttempt_renderJobId_providerKind_key"',
);
expect(migration).toContain(
  `UPDATE "AiServiceProvider" SET "enabled" = 0 WHERE "providerType" = 'DUIX'`,
);
expect(migration).toContain(
  `UPDATE "AiModelConfig" SET "enabled" = 0, "isDefault" = 0, "isSelected" = 0`,
);
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/alibaba-video-schema.test.ts tests/unit/digital-human-video-settings.test.ts
```

Expected: failures because the schema, migration, and settings parser do not exist.

- [ ] **Step 3: Add the Prisma models and relations**

Use these persisted invariants:

```prisma
model DigitalHumanRenderJob {
  id                   String   @id @default(cuid())
  trainingSessionId    String
  questionId           String
  questionHash         String
  cacheKey             String
  kind                 String
  mode                 String
  status               String   @default("PENDING")
  interviewerProfileId String
  deadlineAt           DateTime
  winnerAttemptId      String?
  fallbackReason       String?
  createdAt            DateTime @default(now())
  readyAt              DateTime?
  expiredAt            DateTime?
  updatedAt            DateTime @updatedAt

  trainingSession    TrainingSession             @relation(fields: [trainingSessionId], references: [id], onDelete: Cascade)
  interviewerProfile InterviewerAvatarProfile    @relation(fields: [interviewerProfileId], references: [id])
  attempts           DigitalHumanRenderAttempt[]

  @@unique([trainingSessionId, questionId, cacheKey])
  @@index([status, deadlineAt])
}

model DigitalHumanRenderAttempt {
  id                 String   @id @default(cuid())
  renderJobId        String
  providerKind       String
  providerId         String
  modelId            String
  interviewerName    String
  status             String   @default("PENDING")
  upstreamTaskId     String?
  traceId            String?
  nextPollAt         DateTime?
  submittedAt        DateTime?
  firstQueriedAt     DateTime?
  completedAt        DateTime?
  outputAssetId      String?
  outputUrlCiphertext String?
  outputUrlIv         String?
  outputUrlTag        String?
  safeErrorCode      String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  renderJob  DigitalHumanRenderJob   @relation(fields: [renderJobId], references: [id], onDelete: Cascade)
  outputAsset DigitalHumanMediaAsset? @relation(fields: [outputAssetId], references: [id], onDelete: SetNull)

  @@unique([renderJobId, providerKind])
  @@index([status, nextPollAt])
}
```

Also add:

- `TrainingSession.digitalHumanRenderJobs`
- encrypted `MediaStorageConfig` credentials using the same ciphertext/IV/tag pattern as `AiServiceProvider`
- `DigitalHumanMediaAsset` with storage config, opaque object key, MIME type, byte length, purpose, expiry, and cleanup status
- `InterviewerAvatarProfile` with display name, voice, style JSON, portrait asset, Lingmou mapping JSON, EMO mapping JSON, provider role, and enabled flag

The migration must disable existing DUIX providers/models without deleting historical sessions or logs.

- [ ] **Step 4: Add strict runtime types and parsing**

Define:

```ts
export const videoRenderModes = [
  "AUTO_RACE",
  "LINGMOU_ONLY",
  "EMO_ONLY",
] as const;

export type VideoRenderMode = (typeof videoRenderModes)[number];
export type VideoProviderKind = "LINGMOU_BROADCAST" | "ALIBABA_EMO";
export type VideoRenderStatus =
  | "PENDING"
  | "SUBMITTED"
  | "RACING"
  | "READY"
  | "FALLBACK"
  | "FAILED"
  | "EXPIRED";

export interface DigitalHumanVideoRuntimeSettings {
  mode: VideoRenderMode;
  maxWaitMs: 8000;
  lingmouPollMs: readonly [3000, 6000];
  emoPollMs: readonly [8000];
  synchronizeProfiles: boolean;
  primaryProfileId: string;
  secondaryProfileId: string | null;
  lingmouModelId: string;
  emoModelId: string;
}
```

`parseDigitalHumanVideoRuntimeSettings` must reject a deadline other than `8000`, altered polling schedules, missing model/profile IDs, or a missing secondary profile when synchronization is off.

- [ ] **Step 5: Generate Prisma and run focused tests**

Run:

```powershell
npx.cmd prisma generate
npm.cmd test -- tests/unit/alibaba-video-schema.test.ts tests/unit/digital-human-video-settings.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add prisma/schema.prisma prisma/migrations/20260729130000_add_alibaba_video_digital_human lib/media/video/types.ts lib/media/video/settings.ts lib/validators/digitalHumanVideo.ts tests/unit/alibaba-video-schema.test.ts tests/unit/digital-human-video-settings.test.ts
git commit -m "feat: add dual video render persistence"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 2: Add selectable Alibaba video models and retire DUIX runtime

**Files:**

- Modify: `lib/domain/aiServiceConstants.ts`
- Modify: `lib/domain/aiModelSettings.ts`
- Modify: `lib/domain/modelRecommendations.ts`
- Modify: `lib/db/seedAiModels.ts`
- Modify: `lib/validators/aiServices.ts`
- Modify: `components/admin/AiMultimodalConfigFields.tsx`
- Modify: `components/admin/AiServiceConfigPanel.tsx`
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Modify: `lib/media/digitalHumanSessions.ts`
- Modify: `lib/ai/diagnostics.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `lib/client/duixAvatarClient.ts`
- Delete: `lib/media/providers/duix.ts`
- Delete: `lib/media/providers/duixCredentials.ts`
- Delete: `duix-guiji.d.ts`
- Modify: `tests/unit/ai-diagnostics.test.ts`
- Modify: `tests/unit/digital-human-sessions.test.ts`
- Modify: `tests/unit/digital-interviewer-video.test.tsx`
- Modify: `tests/unit/multimodal-config.test.ts`
- Modify: `tests/unit/linux-deployment-package.test.ts`
- Delete: `tests/unit/duix-provider.test.ts`
- Delete: `tests/unit/duix-avatar-client.test.ts`
- Test: `tests/unit/alibaba-video-model-options.test.ts`
- Test: `tests/unit/duix-retirement.test.ts`

- [ ] **Step 1: Write failing catalog and retirement tests**

Assert the administrator can select:

```ts
expect(recommendations).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      providerType: "LINGMOU",
      capability: "DIGITAL_HUMAN_VIDEO",
      modelName: "lingmou-broadcast-video",
    }),
    expect.objectContaining({
      providerType: "TONGYI",
      capability: "DIGITAL_HUMAN_VIDEO",
      modelName: "emo-v1",
    }),
  ]),
);
```

Also assert that source imports, `package.json`, model recommendations, new-provider options, and the interview-room runtime no longer contain `duix-guiji`, `DUIX_H5`, or a selectable `DUIX` provider.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/alibaba-video-model-options.test.ts tests/unit/duix-retirement.test.ts tests/unit/linux-deployment-package.test.ts
```

Expected: failures identify the missing Alibaba video presets and remaining DUIX runtime.

- [ ] **Step 3: Add model settings**

Add provider-specific settings for `DIGITAL_HUMAN_VIDEO`:

```ts
export interface LingmouBroadcastVideoSettings {
  templateId: string;
  audioVariableName: string;
  portraitVariableName: string | null;
  resolution: string;
  fps: number;
  watermark: boolean;
  mode: string;
}

export interface AlibabaEmoVideoSettings {
  model: "emo-v1";
  ratio: "1:1" | "3:4";
}
```

The Alibaba provider form adds a generic encrypted `apiKey` field for DashScope and keeps existing ASR/TTS-specific keys compatible. EMO credential resolution uses `apiKey`, then the existing TTS key only as a backward-compatible fallback.

The model dropdown keeps `自定义` for unknown compatible providers/models.

- [ ] **Step 4: Remove DUIX from all new runtime paths**

Remove the package and install OSS:

```powershell
npm.cmd uninstall duix-guiji
npm.cmd install ali-oss
```

Delete the DUIX adapters and declarations. Remove `DUIX_H5` creation/playback/diagnostic branches. Keep historical database strings readable. Keep the existing Lingmou real-time and local-avatar paths until the new asynchronous playback replaces the room path in Task 9.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/alibaba-video-model-options.test.ts tests/unit/duix-retirement.test.ts tests/unit/linux-deployment-package.test.ts
```

Expected: Alibaba presets are present, `ali-oss` is packaged, and no new DUIX runtime remains.

- [ ] **Step 6: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add package.json package-lock.json lib/domain/aiServiceConstants.ts lib/domain/aiModelSettings.ts lib/domain/modelRecommendations.ts lib/db/seedAiModels.ts lib/validators/aiServices.ts components/admin/AiMultimodalConfigFields.tsx components/admin/AiServiceConfigPanel.tsx components/practice/DigitalInterviewerVideo.tsx lib/media/digitalHumanSessions.ts lib/ai/diagnostics.ts tests/unit/ai-diagnostics.test.ts tests/unit/digital-human-sessions.test.ts tests/unit/digital-interviewer-video.test.tsx tests/unit/multimodal-config.test.ts tests/unit/linux-deployment-package.test.ts tests/unit/alibaba-video-model-options.test.ts tests/unit/duix-retirement.test.ts
git add -u lib/client/duixAvatarClient.ts lib/media/providers/duix.ts lib/media/providers/duixCredentials.ts tests/unit/duix-provider.test.ts tests/unit/duix-avatar-client.test.ts
git add -u duix-guiji.d.ts
git commit -m "feat: replace duix options with Alibaba video models"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 3: Implement encrypted OSS media storage and PCM-to-WAV conversion

**Files:**

- Create: `lib/media/audio/pcmWav.ts`
- Create: `lib/media/storage/types.ts`
- Create: `lib/media/storage/ossCredentials.ts`
- Create: `lib/media/storage/ossStorage.ts`
- Create: `lib/media/storage/mediaAssets.ts`
- Create: `tests/unit/pcm-wav.test.ts`
- Create: `tests/unit/oss-storage-contract.test.ts`
- Create: `tests/integration/media-storage-config.test.ts`

- [ ] **Step 1: Write failing pure contract tests**

Cover WAV headers, byte lengths, random object naming, URL expiry bounds, credential encryption, and response redaction:

```ts
const wav = pcm16MonoToWav(Buffer.alloc(96000), 48000);
expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
expect(wav.readUInt32LE(24)).toBe(48000);
expect(wav.readUInt16LE(22)).toBe(1);

const first = createPrivateObjectKey("audio", "wav");
const second = createPrivateObjectKey("audio", "wav");
expect(first).not.toBe(second);
expect(first).not.toMatch(/candidate|question|岗位|姓名/i);
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/pcm-wav.test.ts tests/unit/oss-storage-contract.test.ts tests/integration/media-storage-config.test.ts
```

Expected: modules are missing.

- [ ] **Step 3: Implement the storage boundary**

Expose:

```ts
export interface PrivateMediaStorage {
  putObject(input: {
    purpose: "PORTRAIT" | "TTS_AUDIO" | "VIDEO_OUTPUT";
    body: Buffer;
    contentType: string;
    expiresAt: Date;
  }): Promise<{ objectKey: string; byteLength: number }>;
  createReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  removeObject(objectKey: string): Promise<void>;
}
```

Use `ali-oss` only inside `ossStorage.ts`. Clamp signed URLs to 60–900 seconds. Use UUID-based object keys with no user content. Save credentials through the existing AES-256-GCM helpers. Never persist a signed URL.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/pcm-wav.test.ts tests/unit/oss-storage-contract.test.ts tests/integration/media-storage-config.test.ts
```

Expected: all storage and WAV tests pass.

- [ ] **Step 5: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add lib/media/audio lib/media/storage tests/unit/pcm-wav.test.ts tests/unit/oss-storage-contract.test.ts tests/integration/media-storage-config.test.ts
git commit -m "feat: add secure OSS media storage"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 4: Implement the Lingmou broadcast video adapter

**Files:**

- Create: `lib/media/video/providers/lingmouBroadcast.ts`
- Create: `lib/media/video/providers/lingmouBroadcastProtocol.ts`
- Create: `tests/unit/lingmou-broadcast-protocol.test.ts`
- Create: `tests/unit/lingmou-broadcast-config.test.ts`

- [ ] **Step 1: Write failing request/response contract tests**

Test pure builders and parsers against the installed SDK types:

```ts
const request = buildLingmouCreateRequest({
  name: "render-job-01",
  templateId: "template-01",
  audioVariableName: "audio",
  audioUrl: "https://signed.example/audio.wav",
  portraitVariableName: "portrait",
  portraitUrl: "https://signed.example/portrait.png",
  resolution: "1080p",
  fps: 25,
  watermark: false,
  mode: "standard",
});

expect(request.templateId).toBe("template-01");
expect(request.variables).toEqual([
  expect.objectContaining({ name: "audio", type: "audio" }),
  expect.objectContaining({ name: "portrait", type: "image" }),
]);
```

Parse `PENDING`, processing, success, failure, missing ID, missing video URL, and a multi-ID response that must select only the requested task.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/lingmou-broadcast-protocol.test.ts tests/unit/lingmou-broadcast-config.test.ts
```

Expected: adapter modules are missing.

- [ ] **Step 3: Implement the adapter**

Implement:

```ts
export interface AsyncAvatarVideoProvider {
  submit(input: VideoSubmitInput): Promise<{
    upstreamTaskId: string;
    traceId: string | null;
  }>;
  query(upstreamTaskId: string): Promise<VideoQueryResult>;
}
```

Use:

- `GetBroadcastTemplate` for explicit administrator diagnostics
- `CreateBroadcastVideoFromTemplate` for submission
- `ListBroadcastVideosById` for status
- `cn-beijing` as the documented default, while honoring stored region

Map provider statuses into the project status enum. Return safe internal codes and keep raw SDK errors server-side with secret values removed.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/lingmou-broadcast-protocol.test.ts tests/unit/lingmou-broadcast-config.test.ts
```

Expected: request construction, status parsing, and configuration validation pass.

- [ ] **Step 5: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add lib/media/video/providers/lingmouBroadcast.ts lib/media/video/providers/lingmouBroadcastProtocol.ts tests/unit/lingmou-broadcast-protocol.test.ts tests/unit/lingmou-broadcast-config.test.ts
git commit -m "feat: add Lingmou broadcast adapter"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 5: Implement the Bailian EMO adapter

**Files:**

- Create: `lib/media/video/providers/alibabaEmo.ts`
- Create: `lib/media/video/providers/alibabaEmoProtocol.ts`
- Create: `tests/unit/alibaba-emo-protocol.test.ts`
- Create: `tests/unit/alibaba-emo-config.test.ts`

- [ ] **Step 1: Write failing EMO protocol tests**

Assert:

```ts
const request = buildEmoSubmitRequest({
  model: "emo-v1",
  portraitUrl: "https://signed.example/portrait.png",
  audioUrl: "https://signed.example/audio.wav",
  ratio: "1:1",
});

expect(request.url).toBe(
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis",
);
expect(request.headers["X-DashScope-Async"]).toBe("enable");
expect(request.body).toEqual({
  model: "emo-v1",
  input: {
    image_url: "https://signed.example/portrait.png",
    audio_url: "https://signed.example/audio.wav",
  },
  parameters: { ratio: "1:1" },
});
```

Also cover the DashScope task-query endpoint, all documented task states, absent output URL, HTTP errors, malformed JSON, and safe error mapping.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/alibaba-emo-protocol.test.ts tests/unit/alibaba-emo-config.test.ts
```

Expected: adapter modules are missing.

- [ ] **Step 3: Implement EMO submission and query**

Requirements:

- Bearer authentication stays server-side.
- Input URLs must be HTTPS.
- Portrait metadata must satisfy supported format and minimum-side rules before a paid call.
- Audio must be WAV or MP3 and no larger than 15 MB.
- Task status maps deterministically to the shared provider result.
- The adapter never logs request authorization, signed URLs, or full upstream bodies.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/alibaba-emo-protocol.test.ts tests/unit/alibaba-emo-config.test.ts
```

Expected: request and parser contracts pass.

- [ ] **Step 5: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add lib/media/video/providers/alibabaEmo.ts lib/media/video/providers/alibabaEmoProtocol.ts tests/unit/alibaba-emo-protocol.test.ts tests/unit/alibaba-emo-config.test.ts
git commit -m "feat: add Bailian EMO adapter"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 6: Produce styled speech assets and add explicit paid diagnostics

**Files:**

- Create: `lib/media/video/speechAsset.ts`
- Create: `lib/media/video/diagnostics.ts`
- Create: `app/api/ai-services/digital-human-video-diagnostics/route.ts`
- Modify: `lib/ai/diagnostics.ts`
- Create: `tests/unit/video-speech-asset.test.ts`
- Create: `tests/unit/digital-human-video-diagnostics.test.ts`
- Create: `tests/integration/digital-human-video-diagnostics-route.test.ts`

- [ ] **Step 1: Write failing service tests**

Use deterministic pure inputs and explicit boundary objects; do not add a provider named mock or use `vi.mock`.

Verify that:

- `buildInterviewTtsStyle` receives stage, question intent, answer signals, and interviewer voice settings
- Qwen PCM becomes a valid WAV before OSS upload
- portrait and audio signed URLs are generated only immediately before submission
- configuration checks never call paid APIs
- paid diagnostics require `confirmPaidRequest: true`
- diagnostics return `NOT_CONFIGURED`, `CONFIG_VALID`, `REACHABLE`, or a safe provider error
- API responses never include keys, signed URLs, audio, or raw provider bodies

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/video-speech-asset.test.ts tests/unit/digital-human-video-diagnostics.test.ts tests/integration/digital-human-video-diagnostics-route.test.ts
```

Expected: services and route are missing.

- [ ] **Step 3: Implement speech asset creation**

Reuse the selected `TTS` model and existing emotional style builder:

```ts
export interface VideoSpeechAssetRequest {
  sessionId: string;
  questionId: string;
  question: string;
  stage: string;
  interviewerProfileId: string;
  behaviorSignals: Record<string, unknown> | null;
}
```

Create styled Qwen audio, convert PCM to WAV, upload it privately, and return only an internal asset ID. Voice and emotion must change when the interview context or the question intent calls for it, not only when the stage changes.

- [ ] **Step 4: Implement safe diagnostics**

Configuration-only checks validate local data without network calls. Paid diagnostics run exactly one explicitly selected provider operation after administrator confirmation and store a redacted audit result.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/video-speech-asset.test.ts tests/unit/digital-human-video-diagnostics.test.ts tests/integration/digital-human-video-diagnostics-route.test.ts
```

Expected: service and route tests pass.

- [ ] **Step 6: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add lib/media/video/speechAsset.ts lib/media/video/diagnostics.ts lib/ai/diagnostics.ts app/api/ai-services/digital-human-video-diagnostics tests/unit/video-speech-asset.test.ts tests/unit/digital-human-video-diagnostics.test.ts tests/integration/digital-human-video-diagnostics-route.test.ts
git commit -m "feat: add styled video speech and diagnostics"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 7: Implement the persistent preset and race orchestrator

**Files:**

- Create: `lib/media/video/renderRepository.ts`
- Create: `lib/media/video/renderOrchestrator.ts`
- Create: `lib/media/video/renderSchedule.ts`
- Create: `lib/media/video/renderCache.ts`
- Create: `tests/unit/video-render-schedule.test.ts`
- Create: `tests/unit/video-render-winner.test.ts`
- Create: `tests/integration/video-render-orchestrator.test.ts`

- [ ] **Step 1: Write failing scheduling and database tests**

Cover:

```ts
expect(getDueProviders(2999, settings)).toEqual([]);
expect(getDueProviders(3000, settings)).toEqual(["LINGMOU_BROADCAST"]);
expect(getDueProviders(6000, settings)).toEqual(["LINGMOU_BROADCAST"]);
expect(getDueProviders(8000, settings)).toEqual([
  "LINGMOU_BROADCAST",
  "ALIBABA_EMO",
]);
```

Also verify:

- preset jobs submit Lingmou first and submit EMO only after an explicit Lingmou failure
- dynamic jobs submit both providers once
- duplicate POSTs reuse the unique render job
- the first observed success wins
- equal-observation success prefers the earlier trustworthy `completedAt`, then Lingmou
- the winner cannot change after `READY`
- 8 seconds atomically selects `FALLBACK`
- a late success is cached but never interrupts playback
- process restart resumes from database timestamps
- synchronized and separate interviewer profiles select the correct visible interviewer

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/video-render-schedule.test.ts tests/unit/video-render-winner.test.ts tests/integration/video-render-orchestrator.test.ts
```

Expected: orchestrator modules are missing.

- [ ] **Step 3: Implement repository transactions**

Use Prisma transactions for:

- idempotent job creation
- one attempt per provider per job
- submission state transitions
- due-query claiming
- winner selection
- fallback finalization
- late-result caching

Do not use an in-process `Promise` as the source of truth.

- [ ] **Step 4: Implement orchestration**

Expose:

```ts
export interface RenderOrchestrator {
  ensurePresetJob(input: EnsureRenderInput): Promise<RenderSnapshot>;
  startDynamicRace(input: EnsureRenderInput): Promise<RenderSnapshot>;
  advance(renderJobId: string, observedAt: Date): Promise<RenderSnapshot>;
  collectLateResults(renderJobId: string, observedAt: Date): Promise<void>;
}
```

The caller supplies `observedAt`, making the 3/6/8-second decisions testable without clock manipulation. Provider calls only occur after the database transaction reserves the transition.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/video-render-schedule.test.ts tests/unit/video-render-winner.test.ts tests/integration/video-render-orchestrator.test.ts
```

Expected: all scheduling, idempotency, restart, and winner tests pass.

- [ ] **Step 6: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add lib/media/video/renderRepository.ts lib/media/video/renderOrchestrator.ts lib/media/video/renderSchedule.ts lib/media/video/renderCache.ts tests/unit/video-render-schedule.test.ts tests/unit/video-render-winner.test.ts tests/integration/video-render-orchestrator.test.ts
git commit -m "feat: orchestrate Alibaba video render races"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 8: Add render APIs and preset-question prewarming

**Files:**

- Create: `app/api/digital-human/renders/route.ts`
- Create: `app/api/digital-human/renders/[renderId]/route.ts`
- Create: `app/api/digital-human/renders/prewarm/route.ts`
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/sessions/[sessionId]/answer/route.ts`
- Create: `lib/validators/digitalHumanRender.ts`
- Create: `tests/integration/digital-human-render-routes.test.ts`
- Create: `tests/integration/preset-render-prewarm.test.ts`

- [ ] **Step 1: Write failing route contract tests**

Test authenticated ownership, input validation, idempotency, safe responses, and fallback:

```ts
expect(body).toMatchObject({
  renderId: expect.any(String),
  status: expect.stringMatching(/PENDING|SUBMITTED|RACING|READY|FALLBACK/),
  deadlineAt: expect.any(String),
});
expect(JSON.stringify(body)).not.toMatch(
  /accesskey|api[_-]?key|authorization|signed\.example|rawResponse/i,
);
```

Ensure a candidate cannot query another candidate's render and that only an administrator can request diagnostic details.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/integration/digital-human-render-routes.test.ts tests/integration/preset-render-prewarm.test.ts
```

Expected: routes are missing.

- [ ] **Step 3: Implement project-owned APIs**

- `POST /api/digital-human/renders`: ensure a preset job or start a dynamic race
- `GET /api/digital-human/renders/:renderId`: advance due polling and return the current safe snapshot
- `POST /api/digital-human/renders/prewarm`: create and advance current/next preset jobs

Return interviewer display name, provider label, status, deadline, elapsed time, and a project-owned short-lived playback URL only after `READY`.

- [ ] **Step 4: Integrate session creation and follow-ups**

Session creation persists placeholder render jobs for the generated outline without blocking on cloud completion. Room entry calls prewarm for the current and next question. The answer route keeps the generated follow-up as the factual source; the client starts the dynamic video race using the returned follow-up ID/text.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/integration/digital-human-render-routes.test.ts tests/integration/preset-render-prewarm.test.ts
```

Expected: ownership, prewarming, safe response, and fallback tests pass.

- [ ] **Step 6: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add app/api/digital-human/renders/route.ts app/api/digital-human/renders/[renderId]/route.ts app/api/digital-human/renders/prewarm/route.ts app/api/sessions/route.ts app/api/sessions/[sessionId]/answer/route.ts lib/validators/digitalHumanRender.ts tests/integration/digital-human-render-routes.test.ts tests/integration/preset-render-prewarm.test.ts
git commit -m "feat: expose persistent video render APIs"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and build pass; GitHub receives the commit.

## Task 9: Add administrator configuration and interview-room playback

**Files:**

- Create: `app/api/ai-services/digital-human-video-runtime/route.ts`
- Create: `app/api/admin/interviewer-profiles/route.ts`
- Create: `app/api/admin/interviewer-profiles/[profileId]/route.ts`
- Create: `components/admin/DigitalHumanVideoConfigPanel.tsx`
- Modify: `app/admin/ai-services/page.tsx`
- Create: `components/practice/DigitalHumanVideoPlayback.tsx`
- Create: `components/practice/useDigitalHumanRender.ts`
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Modify: `components/practice/InterviewRoom.tsx`
- Create: `tests/unit/digital-human-video-config-panel.test.tsx`
- Create: `tests/unit/digital-human-video-playback.test.tsx`
- Create: `tests/integration/interviewer-profile-routes.test.ts`

- [ ] **Step 1: Write failing UI and API tests**

Verify:

- runtime mode dropdown defaults to `AUTO_RACE`
- `LINGMOU_ONLY`, `EMO_ONLY`, and `自定义` model selection are available
- profile synchronization is on by default
- turning synchronization off requires two complete profiles
- portrait upload rejects unsupported format/dimensions before saving
- a paid diagnostic has a confirmation dialog
- room text stays visible in every render state
- the room shows generating state for no more than 8 seconds
- `READY` shows the winning interviewer/provider and plays video once
- `FALLBACK` uses the existing local avatar plus Qwen speech
- a late result never replaces active playback

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/digital-human-video-config-panel.test.tsx tests/unit/digital-human-video-playback.test.tsx tests/integration/interviewer-profile-routes.test.ts
```

Expected: new components and profile routes are missing.

- [ ] **Step 3: Implement administrator configuration**

Add:

- encrypted OSS configuration
- Lingmou and EMO model selectors
- Auto/Lingmou-only/EMO-only runtime mode
- one-profile synchronization or two named interviewer profiles
- portrait, voice, emotional style, Lingmou template mapping, and EMO ratio
- safe configuration validation
- explicit paid diagnostics with cost warning

The UI must never reveal stored secrets after save.

- [ ] **Step 4: Implement room polling and playback**

`useDigitalHumanRender` starts/reuses a render and polls the project API. `DigitalHumanVideoPlayback` manages waiting animation, video fade-in, one-shot playback, provider/interviewer label, and fallback. Reuse the existing Qwen speech endpoint and local animated avatar when the render reaches `FALLBACK`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/unit/digital-human-video-config-panel.test.tsx tests/unit/digital-human-video-playback.test.tsx tests/integration/interviewer-profile-routes.test.ts
```

Expected: UI behavior and secured profile APIs pass.

- [ ] **Step 6: Run the task gate, commit, and push**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git add app/api/ai-services/digital-human-video-runtime/route.ts app/api/admin/interviewer-profiles/route.ts app/api/admin/interviewer-profiles/[profileId]/route.ts app/admin/ai-services/page.tsx components/admin/DigitalHumanVideoConfigPanel.tsx components/practice/DigitalHumanVideoPlayback.tsx components/practice/useDigitalHumanRender.ts components/practice/DigitalInterviewerVideo.tsx components/practice/InterviewRoom.tsx tests/unit/digital-human-video-config-panel.test.tsx tests/unit/digital-human-video-playback.test.tsx tests/integration/interviewer-profile-routes.test.ts
git commit -m "feat: add dual video avatar configuration and playback"
git push origin feature/alibaba-multimodal-integration
```

Expected: tests and production build pass; GitHub receives the commit.

## Task 10: Synchronize environment, Linux, Docker, cleanup, and handoff

**Files:**

- Modify: `.env.example`
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `docker-compose.yml`
- Modify: `docs/linux-deployment.md`
- Modify: `docs/digital-human-and-behavior-interfaces.md`
- Modify: `docs/new-project-handoff-2026-07-16.md`
- Create: `docs/alibaba-video-digital-human-debugging.md`
- Modify: `tests/unit/security.test.ts`
- Modify: `tests/unit/linux-deployment-package.test.ts`

- [ ] **Step 1: Write failing documentation and packaging checks**

Require documentation for:

- OSS bucket creation and private access
- least-privilege RAM credentials
- Lingmou template acquisition and variable mapping
- EMO portrait/audio constraints
- the three debug modes
- the paid diagnostic warning
- the 3/6/8-second schedule
- 24-hour maximum media retention and cleanup
- Windows local debugging and Linux deployment
- Docker shutdown after testing

Require `.env.example` to document only non-secret bootstrap values. Cloud credentials are entered through the encrypted administrator UI, not plain environment variables.

- [ ] **Step 2: Run documentation checks and confirm they fail**

Run:

```powershell
npm.cmd test -- tests/unit/security.test.ts tests/unit/linux-deployment-package.test.ts
```

Expected: checks fail until docs and packaging are synchronized.

- [ ] **Step 3: Update deployment and handoff documentation**

Record exact local-debug sequence:

```powershell
npm.cmd ci
npx.cmd prisma migrate deploy
npm.cmd run build
npm.cmd run dev
```

Record the Linux sequence using the same lockfile and Prisma migration. State that a first-run super administrator is still initialized through the existing setup flow. Include a real-service checklist without embedding credentials.

- [ ] **Step 4: Run the full source verification**

Run:

```powershell
npx.cmd prisma validate
npx.cmd prisma migrate deploy
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: Prisma, the full Vitest suite, production build, and whitespace checks pass.

- [ ] **Step 5: Build and health-check the synchronized Docker image**

Run:

```powershell
docker compose build --no-cache
docker compose up -d
docker compose ps
```

Expected: the application container is healthy and uses the current source and lockfile.

Run a configuration-only health check. Do not run paid Lingmou or EMO diagnostics without the administrator explicitly confirming the charge.

- [ ] **Step 6: Stop Docker completely**

Run:

```powershell
docker compose down --remove-orphans
docker desktop stop
```

Expected: project containers are removed and Docker Desktop is stopped.

- [ ] **Step 7: Commit and push the synchronized handoff**

Run:

```powershell
git status --short
git add .env.example Dockerfile .dockerignore docker-compose.yml docs/linux-deployment.md docs/digital-human-and-behavior-interfaces.md docs/new-project-handoff-2026-07-16.md docs/alibaba-video-digital-human-debugging.md tests/unit/security.test.ts tests/unit/linux-deployment-package.test.ts
git commit -m "docs: hand off Alibaba dual video deployment"
git push origin feature/alibaba-multimodal-integration
```

Expected: only the intentionally untracked repository-root handoff copy remains outside the commit.

## Task 11: Run user-authorized live Alibaba debugging

**Files:**

- Modify only if a real provider incompatibility is proven by redacted evidence.

- [ ] **Step 1: Ask the user to configure credentials locally**

Required local administrator inputs:

- private OSS bucket, endpoint, region, and least-privilege RAM key
- Lingmou RAM key, project/template ID, and variable names
- Bailian DashScope API key
- approved portrait image
- selected Qwen TTS model and voice

Do not ask the user to paste secrets into chat.

- [ ] **Step 2: Run configuration-only diagnostics**

Expected: OSS, Lingmou, EMO, portrait, template mapping, TTS, and runtime settings all report `CONFIG_VALID`.

- [ ] **Step 3: Run paid diagnostics only after explicit UI confirmation**

Execute in order:

1. OSS upload/sign/delete
2. Lingmou-only short video
3. EMO-only short video
4. automatic dynamic race
5. forced 8-second local fallback
6. media cleanup

Expected: the UI reports actual upstream request IDs in administrator-only redacted diagnostics, while candidate-facing responses contain no secret or raw upstream data.

- [ ] **Step 4: Fix only evidence-backed incompatibilities**

For each incompatibility: capture the safe error code and trace ID, add a regression contract test, implement the smallest correction, run the task gate, commit, and push.

- [ ] **Step 5: Shut down local debugging**

Stop the Next.js process. If Docker was used, run:

```powershell
docker compose down --remove-orphans
docker desktop stop
```

Expected: no project debug service or Docker process remains running.

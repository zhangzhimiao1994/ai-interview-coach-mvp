# DUIX Digital Human Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Silicon-based DUIX as the selectable real-time digital human provider for `开发面试数字人`, with secure server-side signing and local-avatar fallback.

**Architecture:** Keep the interview brain in the existing app: outline, questions, follow-up, answers, records, and reports continue to use the current backend. DUIX is added as a media provider that returns browser-safe H5 SDK connection parameters and a browser client that calls `init`, `start`, `speak`, `break`, and `stop`. Lingmou remains in the codebase as an optional backup, but DUIX failure falls back only to `LOCAL_AVATAR`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma SQLite, Vitest, Node `crypto`, DUIX H5 SDK (`duix-guiji`), existing encrypted AI-service credential storage.

## Global Constraints

- Do not push during this run; the user said `不推送了`.
- GitHub repository remains `zhangzhimiao1994/ai-interview-coach-mvp`; branch remains `feature/alibaba-multimodal-integration`.
- Display name remains `开发面试数字人`.
- Do not read, modify, stage, or commit root `new-project-handoff-2026-07-16.md`.
- Do not commit `.env`, real credentials, database files, logs, generated audio, or Docker runtime data.
- DUIX `appSecret` is encrypted server-side and never returned to the browser, logs, model settings, or Git.
- DUIX is the default provider path for `DIGITAL_HUMAN_REALTIME` after complete admin configuration.
- DUIX ASR and DUIX LLM are disabled in the first real debugging round; current interview ASR and backend question logic remain authoritative.
- First DUIX round uses DUIX built-in voice through text-driven `speak`; external CosyVoice audio driving is later work.
- DUIX failure falls back to `LOCAL_AVATAR`; there is no automatic paid Lingmou fallback.
- Official DUIX H5 docs require `sign`, `containerLable`, `conversationId`, `speak({ content, interrupt })`, `break()`, and `stop()`; server API docs describe HMAC-SHA256 JWT with `appId`, `iat`, and `exp`.

---

### Task 0: Isolate Incomplete Lingmou Work

**Files:**
- Preserve without editing: `lib/client/lingmouRtcConnection.ts`
- Preserve without editing: `lib/media/providers/lingmou.ts`
- Preserve without editing: `lib/media/providers/lingmouCredentials.ts`
- Preserve without editing: `tests/unit/lingmou-provider.test.ts`

**Interfaces:**
- Consumes: current dirty tracked Lingmou changes.
- Produces: clean baseline for DUIX work while leaving the root handoff file untouched.

- [ ] **Step 1: Confirm only the known tracked files are dirty**

Run: `git status --short`

Expected: the four tracked Lingmou files are modified, root `new-project-handoff-2026-07-16.md` is untracked, and no DUIX implementation files are dirty.

- [ ] **Step 2: Save a tracked-only recoverable stash**

Run: `git stash push -m "wip: preserve unfinished Lingmou client-rendering changes" -- lib/client/lingmouRtcConnection.ts lib/media/providers/lingmou.ts lib/media/providers/lingmouCredentials.ts tests/unit/lingmou-provider.test.ts`

Expected: the four Lingmou tracked files are removed from the working tree changes; root handoff remains untracked.

- [ ] **Step 3: Verify clean DUIX baseline**

Run: `git status --short`

Expected: only `?? new-project-handoff-2026-07-16.md` remains.

### Task 1: DUIX Configuration, Credentials, and Signatures

**Files:**
- Modify: `lib/domain/aiServiceConstants.ts`
- Modify: `components/admin/AiServiceConfigPanel.tsx`
- Modify: `components/admin/AiMultimodalConfigFields.tsx`
- Modify: `lib/domain/aiModelSettings.ts`
- Create: `lib/media/providers/duixCredentials.ts`
- Create: `lib/media/providers/duix.ts`
- Modify: `lib/ai/diagnostics.ts`
- Test: `tests/unit/duix-provider.test.ts`
- Test: `tests/unit/multimodal-config.test.ts`
- Test: `tests/unit/ai-diagnostics.test.ts`

**Interfaces:**
- Consumes: `ResolvedMediaModel`, encrypted structured credentials, `CredentialMap`, `MediaConfigurationError`, `MediaProviderError`.
- Produces: `duixAdapterContract`, `parseDuixCredentials(source)`, `createDuixSign({ appId, appSecret, now, ttlSeconds })`, `createDuixProvider(model, deps)`, and diagnostic support for provider type `DUIX`.

- [ ] **Step 1: Write failing config and signature tests**

Add `tests/unit/duix-provider.test.ts` covering:

```ts
it("creates a browser-safe DUIX connection without leaking appSecret", async () => {
  const provider = createDuixProvider(resolvedDuixModel(), { now: () => new Date("2026-07-23T00:00:00.000Z") });
  const session = await provider.createSession({ trainingSessionId: "training-1" });
  expect(session.connection.metadata).toMatchObject({
    adapter: "DUIX_H5_SDK",
    conversationId: "conv-1",
    platform: "duix.com",
    sdkPackage: "duix-guiji"
  });
  expect(JSON.stringify(session)).not.toContain("secret-1");
});
```

Also add tests that missing `appId`, missing `appSecret`, wrong `modelName`, missing `conversationId`, and wrong adapter settings throw fixed `MediaConfigurationError.code` values.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/duix-provider.test.ts tests/unit/multimodal-config.test.ts tests/unit/ai-diagnostics.test.ts`

Expected: fail because DUIX constants, parser, and provider do not exist yet.

- [ ] **Step 3: Implement minimal DUIX provider type and admin form fields**

Change `aiProviderTypes` to include `"DUIX"` after `"LINGMOU"`. Add label `"硅基 DUIX 数字人"` and skip generic Base URL/API Key fields for DUIX. Add `DuixProviderFields` with `appId`, `appSecret`, and `platform`.

For model settings, when `capability === "DIGITAL_HUMAN_REALTIME"`, read both Lingmou and DUIX inputs:

```ts
return {
  configId: String(form.get("configId") || ""),
  instanceId: String(form.get("instanceId") || ""),
  conversationId: String(form.get("conversationId") || ""),
  renderMode: String(form.get("renderMode") || "cloud"),
  integrationMode: String(form.get("integrationMode") || "audio-driven"),
  client: "web",
  speechMode: String(form.get("speechMode") || "duix-managed")
};
```

- [ ] **Step 4: Implement credential parsing and JWT sign**

`lib/media/providers/duixCredentials.ts` exports:

```ts
export const duixAdapterContract = {
  modelName: "duix-h5-realtime",
  adapter: "DUIX_H5_SDK",
  client: "web",
  interactionMode: "direct-drive",
  speechMode: "duix-managed",
  defaultPlatform: "duix.com"
} as const;
```

It validates provider type `DUIX`, decrypts structured credentials `appId` and `appSecret`, validates `conversationId`, and returns only parsed values.

`createDuixSign` manually creates a compact JWT using Node `crypto.createHmac("sha256", appSecret)` with header `{ alg: "HS256", typ: "JWT" }`, payload `{ appId, iat, exp }`, and base64url encoding.

- [ ] **Step 5: Implement DUIX provider**

`lib/media/providers/duix.ts` returns `RealtimeDigitalHumanProvider` where `createSession()` produces:

```ts
{
  provider: model.providerName,
  model: model.modelName,
  mode: "duix-h5-direct-drive",
  traceId,
  fallbackUsed: false,
  sessionId: traceId,
  providerSessionId: traceId,
  connection: {
    protocol: "webrtc",
    metadata: {
      adapter: "DUIX_H5_SDK",
      sign,
      conversationId,
      platform,
      sdkPackage: "duix-guiji",
      openAsr: false,
      speechMode: "duix-managed"
    }
  },
  expiresAt
}
```

`speak()` returns accepted metadata because browser SDK speech is client-side. `stopSession()` is a no-op server-side for first stage; browser `stop()` releases the H5 session.

- [ ] **Step 6: Add diagnostics**

Update `lib/ai/diagnostics.ts` so `DIGITAL_HUMAN_REALTIME` accepts either `DUIX` or `LINGMOU`. DUIX static check validates encrypted `appId/appSecret`, `conversationId`, adapter contract, and returns `CONFIG_VALID/ADAPTER_AVAILABLE`. DUIX live check calls the official lightweight `/duix-openapi-v2/sdk/checkSig?sig=...` endpoint only if an HTTP endpoint is configured; otherwise returns config-valid wording that no paid session was created.

- [ ] **Step 7: Run Task 1 tests and commit locally**

Run: `npm.cmd test -- tests/unit/duix-provider.test.ts tests/unit/multimodal-config.test.ts tests/unit/ai-diagnostics.test.ts`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

Commit: `git add lib/domain/aiServiceConstants.ts components/admin/AiServiceConfigPanel.tsx components/admin/AiMultimodalConfigFields.tsx lib/domain/aiModelSettings.ts lib/media/providers/duixCredentials.ts lib/media/providers/duix.ts lib/ai/diagnostics.ts tests/unit/duix-provider.test.ts tests/unit/multimodal-config.test.ts tests/unit/ai-diagnostics.test.ts && git commit -m "feat: add DUIX provider configuration"`

### Task 2: Digital Human Session Service Supports DUIX

**Files:**
- Modify: `lib/media/types.ts`
- Modify: `lib/media/digitalHumanSessions.ts`
- Modify: `app/api/digital-human/sessions/handler.ts`
- Test: `tests/unit/duix-digital-human-session.test.ts`
- Test: `tests/unit/digital-human-sessions.test.ts` if present, otherwise extend `tests/unit/lingmou-provider.test.ts` only for shared session behavior.

**Interfaces:**
- Consumes: `createDuixProvider(model)`, `createLingmouProvider(model)`, `ResolvedMediaModel.providerType`.
- Produces: `DigitalHumanSessionMode = "DUIX_H5" | "LINGMOU_CLOUD" | "LOCAL_AVATAR"` and public DUIX connection metadata.

- [ ] **Step 1: Write failing session tests**

Add `tests/unit/duix-digital-human-session.test.ts` proving:

```ts
it("creates a DUIX_H5 public session when selected realtime model is DUIX", async () => {
  const service = createDigitalHumanSessionService({
    repository: fakeRepository(),
    resolveRealtimeModel: async () => resolvedDuixModel(),
    createProvider: (model) => createDuixProvider(model, { now: fixedNow })
  });
  await expect(service.createDigitalHumanSession("training-1")).resolves.toMatchObject({
    mode: "DUIX_H5",
    status: "READY",
    reasonCode: null,
    connection: { protocol: "webrtc" }
  });
});
```

Also prove DUIX provider errors downgrade to `LOCAL_AVATAR` with reason `DUIX_UPSTREAM_FAILED`, and failed configuration downgrades with `DUIX_NOT_CONFIGURED`.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/duix-digital-human-session.test.ts`

Expected: fail because session service only knows Lingmou.

- [ ] **Step 3: Generalize provider factory injection**

Replace the Lingmou-only dependency with:

```ts
createProvider: (model: ResolvedMediaModel) => RealtimeDigitalHumanProvider;
```

Default factory returns `createDuixProvider(model)` for provider type `DUIX`, `createLingmouProvider(model)` for provider type `LINGMOU`, and throws `MediaConfigurationError` with code `DIGITAL_HUMAN_PROVIDER_NOT_ADAPTED` otherwise.

- [ ] **Step 4: Persist DUIX sessions correctly**

When selected provider type is `DUIX`, create the internal record with `adapter: "DUIX_H5_SDK"` and `mode: "DUIX_H5"`. Do not enqueue Lingmou recovery for DUIX. `stopDigitalHumanSessionWork` treats `DUIX_H5` as browser-released and only transitions local state.

- [ ] **Step 5: Run Task 2 tests and commit locally**

Run: `npm.cmd test -- tests/unit/duix-digital-human-session.test.ts tests/unit/provider-session-close-recoveries.test.ts tests/unit/provider-session-close-recovery-sqlite.test.ts`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

Commit: `git add lib/media/types.ts lib/media/digitalHumanSessions.ts app/api/digital-human/sessions/handler.ts tests/unit/duix-digital-human-session.test.ts && git commit -m "feat: support DUIX digital human sessions"`

### Task 3: Browser DUIX Client and Room Fallback

**Files:**
- Add dependency: `duix-guiji`
- Create: `lib/client/duixAvatarClient.ts`
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Test: `tests/unit/duix-avatar-client.test.ts`
- Test: `tests/unit/digital-interviewer-video.test.tsx`

**Interfaces:**
- Consumes: `PublicDigitalHumanSession.connection.metadata`.
- Produces: `DuixAvatarClient` with `start(connection, root)`, `speak(text, interrupt)`, `interrupt()`, and `exit()`.

- [ ] **Step 1: Add failing client tests**

`tests/unit/duix-avatar-client.test.ts` uses a fake SDK constructor and proves:

```ts
await client.start(connectionWithSignAndConversationId, root);
expect(fakeDuix.init).toHaveBeenCalledWith({
  sign: "jwt-sign",
  containerLable: "#duix-avatar-root"
});
expect(fakeDuix.start).toHaveBeenCalledWith({
  conversationId: "conv-1",
  muted: true,
  openAsr: false,
  wipeGreen: false
});
await client.speak("你好", true);
expect(fakeDuix.speak).toHaveBeenCalledWith({ content: "你好", interrupt: true });
client.interrupt();
expect(fakeDuix.break).toHaveBeenCalled();
await client.exit();
expect(fakeDuix.stop).toHaveBeenCalledTimes(1);
```

Also test SDK `error` and init timeout reject with safe errors.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/duix-avatar-client.test.ts tests/unit/digital-interviewer-video.test.tsx`

Expected: fail because DUIX client and room mode do not exist.

- [ ] **Step 3: Add SDK dependency**

Run: `npm.cmd install duix-guiji@2.1.2`

Expected: `package.json` and lockfile include `duix-guiji`.

- [ ] **Step 4: Implement browser client**

Create `lib/client/duixAvatarClient.ts`. Keep the SDK instance in a private field, not React state. Wait for official `intialSucccess` before `start`, listen for `show`, `error`, `speakStart`, and `speakEnd`, and make `exit()` idempotent.

- [ ] **Step 5: Wire room component**

Update `DigitalInterviewerVideo.tsx` so `session.mode === "DUIX_H5"` creates a `DuixAvatarClient`. On question playback, DUIX mode calls browser `speak(question, true)` and does not call `/speech` for external TTS. Any DUIX client failure calls downgrade endpoint and switches to `LOCAL_AVATAR`.

- [ ] **Step 6: Run Task 3 tests and commit locally**

Run: `npm.cmd test -- tests/unit/duix-avatar-client.test.ts tests/unit/digital-interviewer-video.test.tsx tests/unit/candidate-media-panel.test.tsx`

Expected: PASS.

Run: `npm.cmd build`

Expected: production build succeeds.

Commit: `git add package.json package-lock.json lib/client/duixAvatarClient.ts components/practice/DigitalInterviewerVideo.tsx tests/unit/duix-avatar-client.test.ts tests/unit/digital-interviewer-video.test.tsx && git commit -m "feat: drive interview room with DUIX avatar"`

### Task 4: Docker Sync and Local Verification

**Files:**
- Inspect: `Dockerfile`
- Inspect: `docker-compose.yml`
- Inspect: `.dockerignore`
- Modify: `docs/new-project-handoff-2026-07-16.md`

**Interfaces:**
- Consumes: source version and dependency lockfile.
- Produces: Docker build/runtime matching local source.

- [ ] **Step 1: Write or extend Docker/source sync tests**

If no Docker-specific unit test exists, add assertions to an existing source test that `package-lock.json` includes `duix-guiji` and `.dockerignore` does not ignore required source files.

- [ ] **Step 2: Run full unit tests**

Run: `npm.cmd test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm.cmd build`

Expected: PASS.

- [ ] **Step 4: Build Docker image**

Run: `docker compose build`

Expected: image builds using the same `package-lock.json` and source files.

- [ ] **Step 5: Start Docker only for health verification**

Run: `docker compose up -d`

Expected: app container becomes healthy or serves the app port.

- [ ] **Step 6: Stop containers and Docker Desktop**

Run: `docker compose down`

Then stop Docker Desktop from the local environment after verification.

- [ ] **Step 7: Commit locally**

Run: `git diff --check`

Expected: no output.

Commit: `git add docs/new-project-handoff-2026-07-16.md Dockerfile docker-compose.yml .dockerignore tests package.json package-lock.json && git commit -m "chore: sync DUIX Docker verification"`

Do not stage root `new-project-handoff-2026-07-16.md`.

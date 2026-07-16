# Alibaba Realtime Digital Human Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Deliver a configurable Alibaba `avatar-dialog` interviewer that speaks generated interview questions with synchronized voice and facial motion, streams through Alibaba RTC to desktop and mobile browsers, and falls back visibly when the external service is unavailable.

**Architecture:** The custom Node server owns Alibaba credentials, RTC token signing, the outbound DashScope WebSocket, and all digital-human lifecycle state. The browser receives only short-lived subscriber credentials, joins the RTC channel with `aliyun-rtc-sdk`, and never receives the Alibaba API key or RTC AppKey. Interview text is converted to 24 kHz mono PCM through the configured realtime TTS model and relayed directly into the active avatar session without persisting audio. A provider-neutral adapter keeps Alibaba as the editable default while retaining Tavus and local fallback implementations.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma/SQLite, Node.js `ws`, `aliyun-rtc-sdk`, Zod, Vitest, Testing Library

---

## File Map

**Create:**
- `prisma/migrations/20260715110000_add_digital_human_sessions/migration.sql`
- `lib/domain/digitalHuman.ts`
- `lib/realtime/rtcToken.ts`
- `lib/realtime/avatarSessionRegistry.ts`
- `lib/realtime/avatarGateway.ts`
- `lib/media/providers/alibabaAvatar.ts`
- `lib/media/providers/tavusAvatar.ts`
- `lib/media/digitalHumanRegistry.ts`
- `lib/client/alibabaRtcClient.ts`
- `app/api/digital-human/sessions/route.ts`
- `app/api/digital-human/sessions/[sessionId]/route.ts`
- `app/api/digital-human/sessions/[sessionId]/speak/route.ts`
- `app/api/digital-human/sessions/[sessionId]/heartbeat/route.ts`
- `app/api/ai-services/models/[modelId]/check/route.ts`
- `tests/unit/rtc-token.test.ts`
- `tests/unit/avatar-session-registry.test.ts`
- `tests/unit/alibaba-avatar.test.ts`
- `tests/unit/tavus-avatar.test.ts`
- `tests/unit/digital-human-session.test.ts`
- `tests/unit/digital-interviewer-video.test.tsx`

**Modify:**
- `package.json`
- lockfile used by the repository
- `prisma/schema.prisma`
- `server.mjs`
- `lib/media/types.ts`
- `lib/media/config.ts`
- `lib/media/providers/alibabaTts.ts`
- `components/practice/DigitalInterviewerVideo.tsx`
- `components/practice/InterviewRoom.tsx`
- `components/admin/AiServiceConfigPanel.tsx`
- `scripts/linux/setup.sh`
- `scripts/docker-entrypoint.sh`
- `README.md`
- `.env.example`

## Task 1: Persist Provider-Neutral Digital-Human Sessions

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260715110000_add_digital_human_sessions/migration.sql`
- Create: `lib/domain/digitalHuman.ts`
- Test: `tests/unit/avatar-session-registry.test.ts`

- [ ] **Step 1: Write the lifecycle contract test**

Test the allowed transitions `CONNECTING -> READY -> SPEAKING -> READY -> STOPPING -> STOPPED`, terminal transitions from active states to `FAILED`, and rejection of transitions out of terminal states.

```ts
expect(canTransition("CONNECTING", "READY")).toBe(true);
expect(canTransition("READY", "SPEAKING")).toBe(true);
expect(canTransition("STOPPED", "READY")).toBe(false);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/unit/avatar-session-registry.test.ts`

Expected: FAIL because `lib/domain/digitalHuman.ts` does not exist.

- [ ] **Step 3: Add the database record and domain types**

Add `DigitalHumanSession` with:

```prisma
model DigitalHumanSession {
  id                String          @id @default(cuid())
  trainingSessionId String
  trainingSession   TrainingSession @relation(fields: [trainingSessionId], references: [id], onDelete: Cascade)
  provider          String
  model             String
  providerSessionId String?
  status            String          @default("CONNECTING")
  channelId         String?
  expiresAt         DateTime
  startedAt         DateTime        @default(now())
  endedAt           DateTime?
  stopReason        String?
  lastActivityAt    DateTime        @default(now())

  @@index([trainingSessionId])
  @@index([status, expiresAt])
}
```

Add the reverse relation on `TrainingSession`. Keep API keys, RTC AppKeys, RTC tokens, and raw audio out of the database.

- [ ] **Step 4: Implement lifecycle helpers**

Export the state union, legal transition table, terminal-state predicate, and public DTO. The public DTO may expose provider, model, status, expiry, and RTC subscriber parameters, but never permanent credentials.

- [ ] **Step 5: Apply the migration and pass the test**

Run: `npx prisma migrate dev --name add_digital_human_sessions`

Run: `npm test -- tests/unit/avatar-session-registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma lib/domain/digitalHuman.ts tests/unit/avatar-session-registry.test.ts
git commit -m "add digital human session lifecycle"
```

## Task 2: Sign Short-Lived Alibaba RTC Credentials

**Files:**
- Modify: `package.json`
- Modify: lockfile used by the repository
- Create: `lib/realtime/rtcToken.ts`
- Test: `tests/unit/rtc-token.test.ts`

- [ ] **Step 1: Write deterministic token tests**

Use fixed inputs and time to assert that the token is the lowercase SHA-256 digest of `appId + appKey + channelId + userId + nonce + timestamp`, that `nonce` is empty, and that expiry is expressed as Unix seconds. Add a serialization test proving `appKey` is absent from the returned browser object.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/unit/rtc-token.test.ts`

Expected: FAIL because the signer is missing.

- [ ] **Step 3: Install the official browser RTC package**

Run: `npm install aliyun-rtc-sdk`

Commit the repository's lockfile. Do not load this browser-only SDK from server components.

- [ ] **Step 4: Implement the signer**

```ts
const timestamp = Math.floor(now.getTime() / 1000) + ttlSeconds;
const nonce = "";
const token = createHash("sha256")
  .update(`${appId}${appKey}${channelId}${userId}${nonce}${timestamp}`)
  .digest("hex");
```

Return the documented GSLB URL, AppId, channelId, userId, nonce, timestamp, and token. Validate a bounded TTL and non-empty identifiers with Zod.

- [ ] **Step 5: Run the test**

Run: `npm test -- tests/unit/rtc-token.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/realtime/rtcToken.ts tests/unit/rtc-token.test.ts
git commit -m "add Alibaba RTC credential signing"
```

Use the actual lockfile path if this repository does not use `package-lock.json`.

## Task 3: Build the Alibaba Avatar Adapter and In-Memory Registry

**Files:**
- Modify: `lib/media/types.ts`
- Modify: `lib/media/config.ts`
- Create: `lib/realtime/avatarSessionRegistry.ts`
- Create: `lib/media/providers/alibabaAvatar.ts`
- Create: `lib/media/digitalHumanRegistry.ts`
- Test: `tests/unit/alibaba-avatar.test.ts`
- Test: `tests/unit/avatar-session-registry.test.ts`

- [ ] **Step 1: Write adapter protocol tests with a fake WebSocket**

Assert that the adapter:
- opens the configured DashScope endpoint with a server-side `Authorization: Bearer ...` header;
- sends `run-task` using configured model name, avatar ID, `PCM`, sample rate `24000`, RTC publisher credentials, and explicit Web user-agent metadata;
- becomes ready only after `VideoSessionInitialized`;
- surfaces provider error codes as typed operational errors;
- closes the upstream socket exactly once.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- tests/unit/alibaba-avatar.test.ts tests/unit/avatar-session-registry.test.ts`

Expected: FAIL because the adapter and registry are missing.

- [ ] **Step 3: Extend provider-neutral contracts**

Add a `DigitalHumanProvider` contract with `createSession`, `sendAudio`, `finishUtterance`, `heartbeat`, and `closeSession`. Keep Alibaba event names inside its adapter. Extend the config resolver to require editable `apiKey`, `rtcAppId`, `rtcAppKey`, and `avatarId` settings for Alibaba `DIGITAL_HUMAN_REALTIME` models.

- [ ] **Step 4: Implement the active-session registry**

Store only live process objects in memory: upstream socket, current state, activity timestamp, and a per-session serialized audio queue. Enforce one active digital-human session per training session. Provide `register`, `get`, `touch`, `enqueueAudio`, `close`, and `closeExpired` functions. A process restart intentionally loses this volatile map; Task 5 reconciles persistent orphan records.

- [ ] **Step 5: Implement the Alibaba adapter**

Use the configured endpoint with default `wss://dashscope.aliyuncs.com/api-ws/v1/inference`. Initialize `avatar-dialog` with `task_group: "aigc"`, `task: "video-generation"`, and `function: "stream-generation"`. Send 24 kHz mono PCM chunks in order as `continue-task` events. Validate all inbound messages before changing lifecycle state.

- [ ] **Step 6: Implement provider selection**

Resolve the enabled currently selected model (`isSelected`) for `DIGITAL_HUMAN_REALTIME` at session creation time. Register Alibaba, Tavus, and local fallback provider names, while allowing database selection to change the active provider/model without code changes. `isDefault` remains recommendation/initialization metadata and must not be used for runtime routing.

- [ ] **Step 7: Run tests**

Run: `npm test -- tests/unit/alibaba-avatar.test.ts tests/unit/avatar-session-registry.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/media lib/realtime/avatarSessionRegistry.ts tests/unit/alibaba-avatar.test.ts tests/unit/avatar-session-registry.test.ts
git commit -m "add configurable Alibaba avatar adapter"
```

## Task 4: Expose Authenticated Session Lifecycle APIs

**Files:**
- Create: `app/api/digital-human/sessions/route.ts`
- Create: `app/api/digital-human/sessions/[sessionId]/route.ts`
- Create: `app/api/digital-human/sessions/[sessionId]/heartbeat/route.ts`
- Create: `tests/unit/digital-human-session.test.ts`

- [ ] **Step 1: Write API tests**

Cover:
- authentication and training-session ownership;
- rejection when the interview is not active;
- one active avatar per training session;
- server-side config resolution;
- separate publisher and subscriber RTC user IDs;
- no API key, RTC AppKey, provider token, or provider socket URL in responses;
- idempotent DELETE;
- heartbeat updates only an active owned session.

- [ ] **Step 2: Run the API tests and confirm they fail**

Run: `npm test -- tests/unit/digital-human-session.test.ts`

Expected: FAIL because the routes are missing.

- [ ] **Step 3: Implement POST session creation**

Validate `{ trainingSessionId }`, load the configured provider, create a bounded channel/user identifier, sign publisher credentials for the adapter and distinct subscriber credentials for the browser, persist the connecting record, then start the adapter. Return only the public session DTO. If startup fails, mark the record `FAILED`, close the socket, and return a typed service error rather than silently presenting mock output as real.

- [ ] **Step 4: Implement heartbeat and DELETE**

Heartbeat updates `lastActivityAt` in both registry and database. DELETE transitions through `STOPPING`, closes the adapter, sets `STOPPED`, records a non-sensitive reason, and remains successful when repeated.

- [ ] **Step 5: Run API tests**

Run: `npm test -- tests/unit/digital-human-session.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/digital-human tests/unit/digital-human-session.test.ts
git commit -m "add digital human lifecycle APIs"
```

## Task 5: Add Server Startup Reconciliation and Idle Cleanup

**Files:**
- Create: `lib/realtime/avatarGateway.ts`
- Modify: `server.mjs`
- Modify: `app/api/digital-human/sessions/[sessionId]/route.ts`
- Test: `tests/unit/avatar-session-registry.test.ts`

- [ ] **Step 1: Add cleanup tests**

Use fake timers to verify that inactive sessions are closed once, database status becomes `STOPPED`, and all non-terminal records found at process startup become `FAILED` with `PROCESS_RESTART` because their sockets cannot be recovered.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/avatar-session-registry.test.ts`

Expected: FAIL on the new cleanup cases.

- [ ] **Step 3: Implement reconciliation**

On server startup, update stale `CONNECTING`, `READY`, `SPEAKING`, and `STOPPING` records to `FAILED` without attempting to reuse their RTC tokens. Log record IDs and provider names, never credential values.

- [ ] **Step 4: Implement idle cleanup**

Start one unreferenced interval in `server.mjs` that calls `closeExpired`. Use a configurable idle timeout with a conservative default, and close all remaining sockets during `SIGTERM`/`SIGINT` before server shutdown. Ensure development hot reload does not create duplicate intervals.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/avatar-session-registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server.mjs lib/realtime/avatarGateway.ts lib/realtime/avatarSessionRegistry.ts app/api/digital-human/sessions tests/unit/avatar-session-registry.test.ts
git commit -m "harden avatar session cleanup"
```

## Task 6: Stream Realtime TTS PCM Into the Avatar

**Files:**
- Modify: `lib/media/providers/alibabaTts.ts`
- Create: `app/api/digital-human/sessions/[sessionId]/speak/route.ts`
- Modify: `lib/realtime/avatarSessionRegistry.ts`
- Test: `tests/unit/alibaba-avatar.test.ts`
- Test: `tests/unit/digital-human-session.test.ts`

- [ ] **Step 1: Write audio-pipeline tests**

Assert that one speak request:
- validates owned active session and bounded text;
- resolves the current `TEXT_TO_SPEECH` default;
- requests 24 kHz, mono, signed 16-bit PCM from `qwen3-tts-instruct-flash-realtime` by default;
- forwards ordered PCM chunks without storing them;
- serializes concurrent utterances;
- returns typed fallback metadata when realtime synthesis fails.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/alibaba-avatar.test.ts tests/unit/digital-human-session.test.ts`

Expected: FAIL on the new speak behavior.

- [ ] **Step 3: Add realtime PCM synthesis**

Extend the Alibaba TTS adapter with a server-only streaming method. Consume provider audio delta events, validate base64 payload size, decode to PCM buffers, and pass each buffer to the avatar queue. Keep the existing non-realtime audio response method for ordinary browser playback fallback.

- [ ] **Step 4: Implement the speak route**

Validate `{ text, turnId }`, require the turn to belong to the training session, transition `READY -> SPEAKING`, stream audio, signal utterance completion, then transition back to `READY`. If avatar streaming fails after TTS succeeds, return a machine-readable fallback reason so the browser can play synthesized audio with the local avatar.

- [ ] **Step 5: Add interruption handling**

Abort the active TTS stream when the interview advances, the browser requests DELETE, or the upstream avatar fails. Do not let audio from a previous question continue after the next question appears.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/alibaba-avatar.test.ts tests/unit/digital-human-session.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/media/providers/alibabaTts.ts lib/realtime/avatarSessionRegistry.ts app/api/digital-human tests
git commit -m "stream interview speech into avatar"
```

## Task 7: Render and Control Alibaba RTC in the Interview Room

**Files:**
- Create: `lib/client/alibabaRtcClient.ts`
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Modify: `components/practice/InterviewRoom.tsx`
- Modify: `tests/unit/digital-interviewer-video.test.tsx`

- [ ] **Step 1: Write component tests**

Test connecting, live, muted, reconnecting, fallback, and ended states. Verify that:
- the SDK is dynamically imported only in the browser;
- the candidate does not publish camera or microphone into the avatar RTC channel;
- provider badges distinguish live Alibaba output from local fallback;
- `pagehide`, interview completion, and explicit exit call DELETE;
- heartbeat stops after teardown;
- an unavailable RTC stream does not block answering questions.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/digital-interviewer-video.test.tsx`

Expected: FAIL because the RTC client is missing.

- [ ] **Step 3: Wrap the RTC SDK**

Create a small client that joins with the short-lived subscriber credentials, subscribes to the avatar's remote audio/video, attaches tracks to supplied elements, emits typed connection states, retries transient disconnects with bounded backoff, and leaves idempotently. Do not request microphone or camera permission in this client; candidate media remains owned by `CandidateMediaPanel`.

- [ ] **Step 4: Upgrade the interviewer component**

Render a stable 16:9 video area with explicit status and mute controls. Start a digital-human session only after the user enters the interview room. On avatar failure, switch to the existing local interviewer face and configured TTS playback while labeling the result as fallback.

- [ ] **Step 5: Wire question speech**

Call the speak API once for each newly active question, keyed by immutable turn/question ID. Disable duplicate calls during React rerenders and stop prior speech during stage changes.

- [ ] **Step 6: Run component tests**

Run: `npm test -- tests/unit/digital-interviewer-video.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/client/alibabaRtcClient.ts components/practice tests/unit/digital-interviewer-video.test.tsx
git commit -m "render Alibaba avatar in interview room"
```

## Task 8: Complete Tavus Fallback and Admin Connection Checks

**Files:**
- Create: `lib/media/providers/tavusAvatar.ts`
- Modify: `lib/media/digitalHumanRegistry.ts`
- Create: `app/api/ai-services/models/[modelId]/check/route.ts`
- Modify: `components/admin/AiServiceConfigPanel.tsx`
- Test: `tests/unit/tavus-avatar.test.ts`
- Test: existing admin API/component tests

- [ ] **Step 1: Write Tavus and connection-check tests**

Test Tavus credential validation, persona/replica configuration, test-mode session creation, cleanup, and typed unavailability. Test that the admin check is authenticated, uses the selected saved model, never returns secrets, and requires explicit confirmation before a billable Alibaba avatar probe.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/tavus-avatar.test.ts tests/api/ai-services.test.ts`

Expected: FAIL on the new capabilities.

- [ ] **Step 3: Implement the Tavus adapter**

Map provider settings to Tavus conversation creation and cleanup behind the common contract. Return a hosted conversation URL for its client mode. Keep Alibaba model names as editable database recommendations, while the independent current selection determines whether Alibaba or Tavus handles a new session.

- [ ] **Step 4: Add tiered admin checks**

Implement a non-billable configuration check for required credentials/settings and an explicit short live probe. For Alibaba, create and immediately close a test avatar session; for Tavus, request test mode. Store only status, latency, provider error code, and timestamp in the existing call log.

- [ ] **Step 5: Improve admin controls**

Expose editable Alibaba endpoint, avatar ID, RTC AppId, encrypted RTC AppKey, sample rate, idle timeout, and model name. Add Tavus API key, persona ID, and replica ID. Show recommendation/default metadata separately from the unique current-model selector provided by the configuration-foundation plan; only the latter changes runtime routing.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/tavus-avatar.test.ts tests/api/ai-services.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/media app/api/ai-services components/admin tests
git commit -m "add avatar provider checks and Tavus fallback"
```

## Task 9: Verify Mobile HTTPS, Deployment, and Failure Behavior

**Files:**
- Modify: `scripts/linux/setup.sh`
- Modify: `scripts/docker-entrypoint.sh`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document configurable defaults**

Document the initial Alibaba defaults while stating that every model and setting is editable in the admin UI:
- digital human: `avatar-dialog`;
- realtime TTS: `qwen3-tts-instruct-flash-realtime`;
- PCM: 24 kHz mono;
- RTC endpoint and DashScope WebSocket endpoint from saved provider settings.

List the Alibaba values the operator must obtain: DashScope API key, RTC AppId, RTC AppKey, and available avatar ID. Explain that AppKey and API key are encrypted at rest and never sent to the browser.

- [ ] **Step 2: Update production proxy guidance**

Document HTTPS as mandatory for production camera/microphone use, same-origin API calls, and WebSocket upgrade headers for the custom Node server. Update Docker and Linux startup commands to run `server.mjs`, preserve graceful `SIGTERM`, and avoid exposing an extra relay port.

- [ ] **Step 3: Run automated verification**

Run:

```bash
npm test
npm run lint
npm run build
npx prisma migrate deploy
```

Expected: all tests pass, lint passes, production build succeeds, and migrations report success.

- [ ] **Step 4: Run desktop browser verification**

Start the production server and verify in Chrome over HTTPS:
- entering an interview creates one avatar session;
- RTC video and real synthesized voice play;
- the question changes once and speech is not duplicated;
- candidate microphone/camera permissions are requested only by the candidate media panel;
- ending the interview stops RTC and the provider session;
- disabling the Alibaba model produces a labeled local fallback.

- [ ] **Step 5: Run mobile browser verification**

On one Android Chrome device and one iOS Safari device, verify portrait and landscape layouts, audible playback after user interaction, camera/microphone capture, RTC reconnection after brief backgrounding, and clean teardown on page exit. Record browser versions and any platform-specific limitation in `README.md`.

- [ ] **Step 6: Check the final diff**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only intended implementation/docs/migration changes, with no whitespace errors or generated secrets.

- [ ] **Step 7: Commit**

```bash
git add scripts/linux/setup.sh scripts/docker-entrypoint.sh .env.example README.md
git commit -m "document Alibaba avatar deployment"
```

## Final Acceptance Criteria

- A signed-in interview owner can start exactly one live digital-human session for an active interview.
- Alibaba `avatar-dialog` receives real 24 kHz PCM generated by the currently selected TTS model and produces synchronized RTC audio/video.
- Desktop and mobile browsers receive only short-lived subscriber credentials and never receive permanent Alibaba secrets.
- Candidate camera/microphone capture stays independent from avatar RTC playback.
- Session end, page exit, idle timeout, provider failure, and process restart all produce a deterministic terminal database state.
- Alibaba models/settings are defaults, not hardcoded restrictions; administrators can add, edit, test, select, and disable alternatives.
- Tavus and local fallback paths use the same provider-neutral contract and are visibly identified when active.
- Automated tests, lint, build, database migration, desktop HTTPS checks, and mobile HTTPS checks pass before release.

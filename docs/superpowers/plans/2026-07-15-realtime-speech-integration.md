# Realtime Speech Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-only speech with configurable Alibaba realtime ASR and TTS while preserving explicit browser fallbacks on desktop and mobile.

**Architecture:** Run Next.js and a same-process `ws` upgrade server from a custom Node entrypoint. The browser sends microphone PCM only to the same-origin ASR WebSocket; the server authenticates and proxies the strict ASR event subset to Alibaba. TTS remains server-side and returns playable audio; both capabilities resolve the enabled currently selected (`isSelected`) database model on every new session. `isDefault` is recommendation metadata only and never participates in ASR or TTS runtime routing.

**Tech Stack:** Next.js 15 custom server, Node.js HTTP, `ws`, Web Audio API, AudioWorklet, React 19, Zod, Vitest, Playwright.

---

## File Map

- Modify `package.json` and lockfile: add `ws`, `@types/ws`, production `tsx`, and custom server scripts.
- Create `server.ts`: Next.js HTTP server plus `/ws/asr` upgrade handling.
- Create `lib/realtime/tickets.ts`: one-time ASR tickets.
- Create `lib/realtime/upgradeRouter.ts`: preserve Next.js upgrades while routing `/ws/asr` to `ws`.
- Create `lib/realtime/asrGateway.ts`: validated browser-to-Alibaba WebSocket proxy.
- Create `lib/media/providers/alibabaCredentials.ts`: decrypt and normalize Alibaba configuration.
- Create `lib/media/providers/alibabaAsr.ts`: upstream URL and event schemas.
- Create `lib/media/providers/alibabaTts.ts`: Qwen TTS request/response implementation.
- Create `app/api/speech-recognition/sessions/route.ts`: issue same-origin tickets.
- Modify `app/api/digital-human/speech/route.ts`: use configured TTS with explicit fallback metadata.
- Create `public/audio/pcm16-worklet.js`: resample microphone audio to PCM16.
- Create `lib/client/alibabaAsrClient.ts`: browser WebSocket lifecycle.
- Modify `components/practice/CandidateMediaPanel.tsx`: Alibaba ASR first, browser recognition fallback.
- Modify `components/practice/DigitalInterviewerVideo.tsx`: play provider audio and expose mode.
- Modify `components/practice/InterviewRoom.tsx`: pass session/question context and speech state.
- Test `tests/unit/realtime-tickets.test.ts`.
- Test `tests/unit/alibaba-asr.test.ts`.
- Test `tests/unit/alibaba-tts.test.ts`.
- Test `tests/unit/digital-human-interface-routes.test.ts`.
- Test `tests/unit/candidate-media-panel.test.tsx`.

### Task 1: Add the custom HTTP/WebSocket server

**Files:**
- Modify: `package.json`
- Create: `server.ts`
- Create: `lib/realtime/tickets.ts`
- Create: `lib/realtime/upgradeRouter.ts`
- Test: `tests/unit/realtime-tickets.test.ts`

- [ ] **Step 1: Write one-time ticket tests**

```ts
import { describe, expect, it } from "vitest";
import { createRealtimeTicketStore } from "@/lib/realtime/tickets";

it("consumes an ASR ticket once and rejects it after expiry", () => {
  const store = createRealtimeTicketStore(() => 1_000);
  const ticket = store.issue({ sessionId: "session-1", modelId: "model-1" }, 60_000);
  expect(store.consume(ticket)?.sessionId).toBe("session-1");
  expect(store.consume(ticket)).toBeNull();
  const expired = store.issue({ sessionId: "session-2", modelId: "model-1" }, 1);
  expect(store.consume(expired, 1_002)).toBeNull();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/realtime-tickets.test.ts`

Expected: FAIL because the ticket store does not exist.

- [ ] **Step 3: Install WebSocket dependencies**

Run: `npm install ws`

Run: `npm install -D @types/ws`

Move the existing `tsx` package to production dependencies because both source and Docker production startup execute `server.ts` directly.

Expected: `package.json` and lockfile include both packages.

- [ ] **Step 4: Implement the ticket store**

```ts
import { randomBytes } from "node:crypto";

type TicketPayload = { sessionId: string; modelId: string };

export function createRealtimeTicketStore(now = Date.now) {
  const tickets = new Map<string, TicketPayload & { expiresAt: number }>();
  return {
    issue(payload: TicketPayload, ttlMs: number) {
      const ticket = randomBytes(24).toString("base64url");
      tickets.set(ticket, { ...payload, expiresAt: now() + ttlMs });
      return ticket;
    },
    consume(ticket: string, currentTime = now()) {
      const value = tickets.get(ticket);
      tickets.delete(ticket);
      return value && value.expiresAt > currentTime ? value : null;
    }
  };
}

export const realtimeTicketStore = createRealtimeTicketStore();
```

- [ ] **Step 5: Create `server.ts`**

Use `next`, `node:http`, and `WebSocketServer({ noServer: true })`. Route normal requests to `app.getRequestHandler()`. Route `/ws/asr` to the same-process WebSocket server and delegate every other upgrade to `app.getUpgradeHandler()` so development HMR keeps working. Until Task 2 wires the ASR gateway, close accepted ASR sockets with retryable code `1013`. Use `--dev` to select development mode.

Update scripts:

```json
{
  "dev": "tsx server.ts --dev",
  "start": "node scripts/validate-production-env.mjs && tsx server.ts"
}
```

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/realtime-tickets.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitattributes package.json package-lock.json server.ts lib/realtime/tickets.ts lib/realtime/upgradeRouter.ts tests/unit/realtime-tickets.test.ts tests/unit/realtime-upgrade-router.test.ts tests/unit/linux-deployment-package.test.ts
git commit -m "add same-process realtime websocket server"
```

### Task 2: Implement Alibaba ASR configuration and gateway

**Files:**
- Create: `lib/media/providers/alibabaCredentials.ts`
- Create: `lib/media/providers/alibabaAsr.ts`
- Create: `lib/realtime/asrGateway.ts`
- Create: `app/api/speech-recognition/sessions/route.ts`
- Test: `tests/unit/alibaba-asr.test.ts`

- [ ] **Step 1: Write failing ASR contract tests**

```ts
import { describe, expect, it } from "vitest";
import { buildAlibabaAsrUrl, parseAlibabaAsrEvent } from "@/lib/media/providers/alibabaAsr";

it("builds the endpoint from the editable database model", () => {
  expect(buildAlibabaAsrUrl({
    workspaceId: "ws-1",
    region: "cn-beijing",
    modelName: "qwen3-asr-flash-realtime-2026-02-10"
  })).toBe("wss://ws-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime-2026-02-10");
});

it("returns only transcript and error events", () => {
  expect(parseAlibabaAsrEvent(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "你好" })))
    .toEqual({ type: "final", text: "你好" });
  expect(parseAlibabaAsrEvent(JSON.stringify({ type: "unknown.vendor.event", secret: "x" }))).toBeNull();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/alibaba-asr.test.ts`

Expected: FAIL because Alibaba ASR modules do not exist.

- [ ] **Step 3: Implement credential resolution**

`resolveAlibabaCredentials(model)` decrypts `credentialsCiphertext/credentialsIv/credentialsTag`, selects `asrApiKey || apiKey`, parses `workspaceId` and `region`, and throws `MediaConfigurationError` when required values are absent. No caller receives the decrypted map in a JSON response.

- [ ] **Step 4: Implement strict event mapping**

Use Zod discriminated unions for Alibaba server events and map them to:

```ts
type ClientAsrEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string; retryable: boolean };
```

Allow client messages only for `session.update`, `input_audio_buffer.append`, `input_audio_buffer.commit`, and `session.finish`. Reject messages larger than 96 KiB and close sessions after the configured maximum duration.

- [ ] **Step 5: Implement the ticket route**

Validate `{ sessionId }`, confirm an `IN_PROGRESS` training session exists, resolve `SPEECH_TO_TEXT`, issue a 60-second ticket, and return:

```ts
{
  mode: "ALIBABA_REALTIME_ASR",
  webSocketUrl: `/ws/asr?ticket=${ticket}`,
  expiresAt,
  model: configured.modelName,
  audio: { format: "pcm", sampleRate: 16000, channels: 1 }
}
```

Rate limit to 10 tickets per session per minute using `consumeRateLimit`.

- [ ] **Step 6: Implement `handleAsrUpgrade`**

Consume the ticket, resolve the model by ticket model ID, open upstream `ws` with headers:

```ts
{
  Authorization: `Bearer ${apiKey}`,
  "X-DashScope-WorkSpace": workspaceId
}
```

Forward only validated events, close both sockets together, and log upstream failures without credentials or audio payloads.

- [ ] **Step 7: Run tests**

Run: `npm test -- tests/unit/alibaba-asr.test.ts tests/unit/realtime-tickets.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/media/providers/alibabaCredentials.ts lib/media/providers/alibabaAsr.ts lib/realtime/asrGateway.ts app/api/speech-recognition/sessions/route.ts tests/unit/alibaba-asr.test.ts
git commit -m "add configurable Alibaba realtime ASR gateway"
```

### Task 3: Capture PCM audio and consume realtime transcripts

**Files:**
- Create: `public/audio/pcm16-worklet.js`
- Create: `lib/client/alibabaAsrClient.ts`
- Modify: `components/practice/CandidateMediaPanel.tsx`
- Test: `tests/unit/candidate-media-panel.test.tsx`

- [ ] **Step 1: Add failing UI source assertions**

Assert the panel contains `createAlibabaAsrClient`, `/api/speech-recognition/sessions`, `ALIBABA_REALTIME_ASR`, and visible fallback text.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/candidate-media-panel.test.tsx`

Expected: FAIL because only browser recognition exists.

- [ ] **Step 3: Implement the AudioWorklet**

The processor receives float input, downsamples from the browser sample rate to 16 kHz, clamps to `[-1, 1]`, writes signed little-endian PCM16, and posts transferable `ArrayBuffer` chunks. Register it as `pcm16-worklet`.

- [ ] **Step 4: Implement the browser ASR client**

`createAlibabaAsrClient` accepts `sessionId`, `MediaStream`, `onPartial`, `onFinal`, `onState`, and `onError`. It requests a ticket, connects to the returned same-origin WebSocket, sends `session.update` with PCM16/VAD configuration, base64-encodes worklet chunks into `input_audio_buffer.append`, and sends `session.finish` on stop.

The client never accepts or stores a supplier API key.

- [ ] **Step 5: Integrate with `CandidateMediaPanel`**

Add `sessionId` prop. “开始语音回答” first tries Alibaba ASR. On configuration or connection failure, use the existing `SpeechRecognition` implementation and display `浏览器识别降级`. Add `speechRecognitionProvider: "alibaba" | "browser" | "none"` to emitted behavior signals in the later behavior migration; until then keep `speechRecognitionUsed` compatible.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/candidate-media-panel.test.tsx tests/unit/alibaba-asr.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/audio/pcm16-worklet.js lib/client/alibabaAsrClient.ts components/practice/CandidateMediaPanel.tsx tests/unit/candidate-media-panel.test.tsx
git commit -m "use Alibaba realtime speech recognition in practice"
```

### Task 4: Implement configurable Alibaba TTS

**Files:**
- Create: `lib/media/providers/alibabaTts.ts`
- Modify: `app/api/digital-human/speech/route.ts`
- Test: `tests/unit/alibaba-tts.test.ts`
- Test: `tests/unit/digital-human-interface-routes.test.ts`

- [ ] **Step 1: Write failing provider and route tests**

Mock `fetch` and assert the request body uses the database `modelName`, voice, language, and instructions. Assert successful route output is `ALIBABA_TTS`, while provider failure returns `BROWSER_TTS_FALLBACK` with `fallbackUsed: true` and a non-secret reason code.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/alibaba-tts.test.ts tests/unit/digital-human-interface-routes.test.ts`

Expected: FAIL because the route always returns browser fallback.

- [ ] **Step 3: Implement TTS provider**

For non-realtime browser playback, call the configured Alibaba HTTP multimodal generation endpoint with:

```ts
{
  model: configured.modelName,
  input: {
    text: input.text,
    voice: input.voice || modelSettings.voice || "Cherry",
    language_type: input.language === "en-US" ? "English" : "Chinese",
    instructions: input.instructions
  }
}
```

Return the provider audio URL, expiration time, `audio/wav`, provider/model labels, and trace ID. Use one retry only for 429/500/502/503/504.

- [ ] **Step 4: Update the route**

Resolve `TEXT_TO_SPEECH`, invoke the adapter, record real success/failure in `AiCallLog`, and return an explicit browser fallback only after logging the failed attempt. Never mark fallback as Alibaba success.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/alibaba-tts.test.ts tests/unit/digital-human-interface-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/media/providers/alibabaTts.ts app/api/digital-human/speech/route.ts tests/unit/alibaba-tts.test.ts tests/unit/digital-human-interface-routes.test.ts
git commit -m "add configurable Alibaba interview speech synthesis"
```

### Task 5: Play real TTS in the digital interviewer

**Files:**
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Modify: `components/practice/InterviewRoom.tsx`
- Test: `tests/unit/digital-interviewer-video.test.tsx`

- [ ] **Step 1: Add failing rendering tests**

Assert the component exposes `阿里真实语音`, `浏览器语音降级`, an `<audio>` element, and does not play provider audio and browser speech simultaneously.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/digital-interviewer-video.test.tsx`

Expected: FAIL because the component only invokes `speechSynthesis`.

- [ ] **Step 3: Implement audio lifecycle**

On a user click, call `/api/digital-human/speech`, assign `audioUrl` to a single `Audio` instance, and use `play`, `pause`, `ended`, and `error` events to drive mouth/status state. If the API returns browser fallback, invoke `SpeechSynthesisUtterance` instead. Cancel and revoke resources on prompt change and unmount.

Expose mode text and retry without rendering a nested card.

- [ ] **Step 4: Pass session context**

Pass `sessionId`, `questionId`, and `expression` from `InterviewRoom`. Pass `storedSession.sessionId` to `CandidateMediaPanel`.

- [ ] **Step 5: Run focused tests and build**

Run: `npm test -- tests/unit/digital-interviewer-video.test.tsx tests/unit/candidate-media-panel.test.tsx tests/unit/digital-human-interface-routes.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: production build succeeds with the custom server entrypoint.

- [ ] **Step 6: Commit**

```bash
git add components/practice/DigitalInterviewerVideo.tsx components/practice/InterviewRoom.tsx tests/unit/digital-interviewer-video.test.tsx
git commit -m "play real provider speech in interview room"
```

### Task 6: Speech regression and manual verification

**Files:**
- Modify: `docs/digital-human-and-behavior-interfaces.md`
- Modify: `docs/linux-deployment.md`

- [ ] **Step 1: Document configuration and fallback modes**

Document Alibaba region/workspace/API keys, editable recommended model defaults, the separate current-selection control, same-origin `/ws/asr`, reverse-proxy WebSocket headers, and browser fallback behavior. Include Nginx `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";`.

- [ ] **Step 2: Run all automated checks**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 3: Verify desktop and mobile manually**

Start the server, use an HTTPS origin, grant microphone permission, confirm live Alibaba transcript updates, provider TTS playback, replay/pause, and explicit browser fallback after disabling the configured model.

- [ ] **Step 4: Commit**

```bash
git add docs/digital-human-and-behavior-interfaces.md docs/linux-deployment.md
git commit -m "document realtime speech deployment"
```

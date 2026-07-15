# Visual Behavior Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze consented candidate camera frames with a configurable visual model and persist only structured, evidence-linked coaching signals.

**Architecture:** Capture at most eight compressed JPEG frames per answer in the browser, submit them with local audio signals and transcript to a provider adapter, and discard images after the request. Alibaba `qwen3.6-flash` is the seeded default; Gemini implements the same contract as an optional secondary adapter. Persist structured observations and confidence on `SessionTurn`, then feed them into follow-up and final-report generation.

**Tech Stack:** React MediaStream/canvas, Next.js route handlers, Zod, Prisma SQLite, Alibaba OpenAI-compatible multimodal API, Vitest.

---

## File Map

- Modify `prisma/schema.prisma`: structured behavior analysis fields on `SessionTurn`.
- Create `prisma/migrations/20260715100000_add_visual_behavior_analysis/migration.sql`.
- Create `lib/domain/behaviorAnalysis.ts`: strict non-diagnostic result schema.
- Create `lib/media/providers/alibabaBehavior.ts`: Qwen visual adapter.
- Create `lib/media/providers/geminiBehavior.ts`: credential-ready Gemini adapter with connection check.
- Create `lib/media/providerRegistry.ts`: select provider by type and capability.
- Modify `app/api/behavior-analysis/route.ts`: validate session/question, images, consent, size, and invoke adapter.
- Create `lib/client/frameSampler.ts`: bounded in-memory frame sampler.
- Modify `components/practice/CandidateMediaPanel.tsx`: consent toggle and frame sampling.
- Modify `components/practice/InterviewRoom.tsx`: analyze before answer submission and include result ID.
- Modify `app/api/sessions/[sessionId]/answer/route.ts`: persist validated analysis.
- Modify `app/api/sessions/[sessionId]/complete/route.ts`: feed analysis into report generation.
- Modify `lib/ai/types.ts`, `lib/ai/mockProvider.ts`, and `lib/ai/openAiCompatibleProvider.ts`: evidence-aware report contract.
- Modify `components/practice/CandidateReport.tsx` and `components/admin/ReportView.tsx`: show confidence and limitations.
- Test `tests/unit/behavior-analysis-schema.test.ts`.
- Test `tests/unit/alibaba-behavior.test.ts`.
- Test `tests/unit/frame-sampler.test.ts`.
- Test `tests/unit/behavior-signals.test.ts`.

### Task 1: Add structured behavior persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260715100000_add_visual_behavior_analysis/migration.sql`
- Create: `lib/domain/behaviorAnalysis.ts`
- Test: `tests/unit/behavior-analysis-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { behaviorAnalysisResultSchema } from "@/lib/domain/behaviorAnalysis";

it("accepts evidence-linked observable dimensions", () => {
  const result = behaviorAnalysisResultSchema.parse({
    status: "COMPLETED",
    provider: "Alibaba Model Studio",
    model: "qwen3.6-flash",
    overallConfidence: 0.82,
    limitations: [],
    dimensions: [{
      key: "camera_attention",
      score: 76,
      confidence: 0.8,
      observations: ["8 帧中有 6 帧面部朝向镜头区域。"],
      evidenceFrames: [0, 1, 3, 4, 6, 7],
      coachingTips: ["回答结论时看向摄像头。"]
    }]
  });
  expect(result.dimensions[0].score).toBe(76);
});

it("rejects diagnostic and unsupported fields", () => {
  expect(() => behaviorAnalysisResultSchema.parse({
    status: "COMPLETED",
    provider: "x",
    model: "x",
    overallConfidence: 1,
    limitations: [],
    personality: "不自信",
    dimensions: []
  })).toThrow();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/behavior-analysis-schema.test.ts`

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Add database fields and migration**

Add to `SessionTurn`:

```prisma
  behaviorAnalysisJson       String?
  behaviorAnalysisStatus     String?
  behaviorAnalysisProvider   String?
  behaviorAnalysisModel      String?
  behaviorAnalysisConfidence Float?
```

Migration:

```sql
ALTER TABLE "SessionTurn" ADD COLUMN "behaviorAnalysisJson" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "behaviorAnalysisStatus" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "behaviorAnalysisProvider" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "behaviorAnalysisModel" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "behaviorAnalysisConfidence" REAL;
```

- [ ] **Step 4: Implement strict schemas**

Define dimension keys as `camera_attention`, `frame_stability`, `visible_engagement`, `professional_framing`, and `environment_distraction`. Scores are integers 0-100, confidence is 0-1, frame indexes are 0-7, and all objects use `.strict()`.

Export a `containsForbiddenBehaviorInference` helper that rejects case-insensitive terms for psychological diagnosis, personality certainty, health diagnosis, and lie detection before persistence.

- [ ] **Step 5: Generate Prisma and run tests**

Run: `npm run db:generate`

Run: `npm test -- tests/unit/behavior-analysis-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260715100000_add_visual_behavior_analysis/migration.sql lib/domain/behaviorAnalysis.ts tests/unit/behavior-analysis-schema.test.ts
git commit -m "add structured visual behavior evidence"
```

### Task 2: Implement Alibaba visual behavior adapter

**Files:**
- Create: `lib/media/providers/alibabaBehavior.ts`
- Create: `lib/media/providers/geminiBehavior.ts`
- Create: `lib/media/providerRegistry.ts`
- Test: `tests/unit/alibaba-behavior.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Mock `fetch`, invoke the adapter with two JPEG data URLs, and assert the request uses the configured model snapshot rather than `qwen3.6-flash`. Return JSON with one forbidden inference and assert the adapter throws `MediaProviderError` instead of publishing it.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/alibaba-behavior.test.ts`

Expected: FAIL because adapters and registry do not exist.

- [ ] **Step 3: Implement Alibaba request construction**

Build an OpenAI-compatible chat completion request with non-thinking JSON mode. The system prompt must require JSON, observable evidence, frame indexes, uncertainty, and no psychological/personality/health/lie inference. User content contains question, transcript, local signals, and image URL parts.

Use this response format:

```ts
response_format: { type: "json_object" },
temperature: configured.temperature,
max_tokens: configured.maxTokens
```

Parse model content through `behaviorAnalysisResultSchema`, overwrite provider/model from trusted configuration, and enforce forbidden-inference scanning.

- [ ] **Step 4: Add Gemini contract adapter**

Implement `checkConnection` and `analyze` using the same input/output types. When Gemini credentials are absent, return a typed `MediaConfigurationError`; do not mock a completed analysis. The request body uses `responseMimeType: "application/json"` and the same JSON schema.

- [ ] **Step 5: Implement registry selection**

Map `TONGYI` to Alibaba behavior, a Gemini `CUSTOM` provider with `settings.vendor === "GEMINI"` to Gemini behavior, and throw for unsupported providers. Registry input is the resolved database model, so model names remain editable.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/alibaba-behavior.test.ts tests/unit/behavior-analysis-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/media/providers/alibabaBehavior.ts lib/media/providers/geminiBehavior.ts lib/media/providerRegistry.ts tests/unit/alibaba-behavior.test.ts
git commit -m "add configurable visual behavior adapters"
```

### Task 3: Replace the local-only behavior API

**Files:**
- Modify: `app/api/behavior-analysis/route.ts`
- Test: `tests/unit/digital-human-interface-routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Test four cases: consent false returns local summary; more than 8 frames returns 400; unknown session/question returns 400/404; configured provider success returns `MODEL_ENHANCED` and strips frame data from the response.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/digital-human-interface-routes.test.ts`

Expected: FAIL because the route rejects images and never calls a model.

- [ ] **Step 3: Implement strict request validation**

Use:

```ts
const frameSchema = z.object({
  index: z.number().int().min(0).max(7),
  capturedAtMs: z.number().int().nonnegative(),
  dataUrl: z.string().regex(/^data:image\/jpeg;base64,/).max(250_000)
}).strict();
```

Require `sessionId`, `questionId`, `question`, `transcript`, `signals`, `visualConsent`, and up to 8 frames. Limit the total decoded image payload to 1.5 MiB.

- [ ] **Step 4: Validate ownership and invoke adapter**

Load the `IN_PROGRESS` session and saved outline, verify `questionId` belongs to it, resolve `VISION_BEHAVIOR_ANALYSIS`, invoke the registry adapter, record `AiCallLog`, and return the structured result. On provider failure return `LOCAL_SIGNAL_SUMMARY` with `fallbackUsed: true`, failure reason code, and no fake visual score.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/digital-human-interface-routes.test.ts tests/unit/alibaba-behavior.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/behavior-analysis/route.ts tests/unit/digital-human-interface-routes.test.ts
git commit -m "analyze consented interview behavior frames"
```

### Task 4: Capture bounded camera frames in memory

**Files:**
- Create: `lib/client/frameSampler.ts`
- Modify: `components/practice/CandidateMediaPanel.tsx`
- Test: `tests/unit/frame-sampler.test.ts`
- Test: `tests/unit/candidate-media-panel.test.tsx`

- [ ] **Step 1: Write failing sampler tests**

```ts
it("keeps at most eight frames and clears them after consume", () => {
  const sampler = createFrameBuffer(8);
  for (let index = 0; index < 12; index += 1) {
    sampler.add({ index, capturedAtMs: index * 5_000, dataUrl: "data:image/jpeg;base64,AA==" });
  }
  expect(sampler.consume()).toHaveLength(8);
  expect(sampler.consume()).toEqual([]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/frame-sampler.test.ts tests/unit/candidate-media-panel.test.tsx`

Expected: FAIL because no sampler or consent control exists.

- [ ] **Step 3: Implement the sampler**

Capture from the existing video element into a reusable 640x360 canvas every configurable 5 seconds, encode JPEG at configurable quality 0.65, and store only in a closure-backed array. `consume()` clears references immediately.

- [ ] **Step 4: Add explicit visual consent**

Add an unchecked checkbox labeled `允许 AI 分析本次回答中的可观察画面表现`. Start sampling only when media is ready, recognition/answering is active, and consent is true. Stop and clear frames when consent is revoked, media stops, question changes, or component unmounts.

Expose `onFrameBatchChange` or `consumeFrames` through a small callback contract owned by `InterviewRoom`; do not place data URLs in React-rendered markup or session storage.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/frame-sampler.test.ts tests/unit/candidate-media-panel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/client/frameSampler.ts components/practice/CandidateMediaPanel.tsx tests/unit/frame-sampler.test.ts tests/unit/candidate-media-panel.test.tsx
git commit -m "capture consented bounded interview frames"
```

### Task 5: Persist analysis with the answer

**Files:**
- Modify: `components/practice/InterviewRoom.tsx`
- Modify: `app/api/sessions/[sessionId]/answer/route.ts`
- Modify: `lib/ai/types.ts`
- Modify: `app/api/sessions/[sessionId]/complete/route.ts`
- Test: `tests/unit/behavior-signals.test.ts`

- [ ] **Step 1: Add failing persistence assertions**

Assert the answer route accepts `behaviorAnalysis`, validates it, and writes all five new columns. Assert completion parses `behaviorAnalysisJson` into `SessionTurnInput.behaviorAnalysis`.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/behavior-signals.test.ts`

Expected: FAIL because only local behavior signals are persisted.

- [ ] **Step 3: Analyze before answer submission**

In `InterviewRoom.submitAnswer`, consume frames once, call `/api/behavior-analysis`, then submit the returned structured result with the answer. If analysis times out after the configured limit, submit the answer with local signals and `behaviorAnalysis.status = "FAILED"`; never block the whole interview indefinitely.

- [ ] **Step 4: Persist trusted structured analysis**

Extend `answerSchema` with optional `behaviorAnalysisResultSchema`. Store JSON, status, provider, model, and overall confidence in the same transaction as `SessionTurn.create`. Pass the result to follow-up coaching as evidence, not as a psychological conclusion.

- [ ] **Step 5: Extend report inputs**

Add `behaviorAnalysis?: BehaviorAnalysisResult` to `SessionTurnInput`, parse it in completion, and update mock/OpenAI-compatible report prompts to cite observations, evidence frame indexes, confidence, and limitations.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/behavior-signals.test.ts tests/unit/session-api.test.ts tests/unit/reports.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/practice/InterviewRoom.tsx app/api/sessions/[sessionId]/answer/route.ts app/api/sessions/[sessionId]/complete/route.ts lib/ai/types.ts lib/ai/mockProvider.ts lib/ai/openAiCompatibleProvider.ts tests/unit/behavior-signals.test.ts
git commit -m "persist visual behavior evidence with answers"
```

### Task 6: Present confidence and limitations in reports

**Files:**
- Modify: `components/practice/CandidateReport.tsx`
- Modify: `components/admin/ReportView.tsx`
- Modify: `docs/digital-human-and-behavior-interfaces.md`
- Test: `tests/unit/candidate-report.test.tsx`
- Test: `tests/unit/admin-report-view.test.tsx`

- [ ] **Step 1: Add failing report tests**

Assert reports show observable dimensions, confidence percentage, evidence count, limitations, and `证据不足` for excluded low-confidence dimensions. Assert forbidden diagnostic wording is absent from fixture output.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/candidate-report.test.tsx tests/unit/admin-report-view.test.tsx`

Expected: FAIL because reports only show local summary lists.

- [ ] **Step 3: Render the structured evidence**

Use compact full-width sections, not nested cards. Show dimension name, score only when confidence meets the configured threshold, confidence, evidence observations, and coaching tips. Always show model limitations near the analysis.

- [ ] **Step 4: Document privacy behavior**

Document consent, frame count/size, provider upload, immediate disposal, persisted fields, administrator disable switch, and prohibited inference categories.

- [ ] **Step 5: Run complete verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/practice/CandidateReport.tsx components/admin/ReportView.tsx docs/digital-human-and-behavior-interfaces.md tests/unit/candidate-report.test.tsx tests/unit/admin-report-view.test.tsx
git commit -m "show evidence-based visual coaching analysis"
```

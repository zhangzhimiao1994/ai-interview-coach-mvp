# Admin Digital Human Behavior Interfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the admin console, make the digital interviewer speak, collect candidate behavior signals, and document provider-ready interfaces.

**Architecture:** Keep the first implementation local and reliable: browser speech synthesis for interviewer voice, browser media APIs for candidate camera/microphone, and server-side JSON interfaces that can later route to paid TTS, digital-human, and behavior-analysis providers. Store behavior evidence per session turn so reports can cite observable signals.

**Tech Stack:** Next.js App Router, React client components, Prisma SQLite, Zod, Vitest, browser `speechSynthesis`, browser `getUserMedia`.

---

### Task 1: Admin Console Navigation

**Files:**
- Create: `components/admin/AdminShell.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/ai-services/page.tsx`
- Modify: `app/admin/candidates/page.tsx`
- Modify: `app/admin/templates/page.tsx`
- Modify: `app/admin/tasks/new/page.tsx`
- Modify: `app/admin/tasks/[taskId]/page.tsx`
- Modify: `app/admin/reports/[sessionId]/page.tsx`
- Test: `tests/unit/admin-navigation.test.tsx`

- [ ] Write a failing render test that expects AI config pages to include `返回后台` and primary admin navigation labels.
- [ ] Add `AdminShell` with top navigation, active item support, and a back-to-admin action.
- [ ] Wrap admin pages with `AdminShell`.
- [ ] Run `npm.cmd test -- tests/unit/admin-navigation.test.tsx`.

### Task 2: More Operational Admin Home

**Files:**
- Modify: `app/admin/page.tsx`
- Test: `tests/unit/admin-dashboard-source.test.ts`

- [ ] Write a failing source test that expects dashboard sections for `服务交付`, `知识库`, `AI能力`, `数字人`, and `行为分析`.
- [ ] Expand the dashboard into operational sections while keeping existing counts and recent tasks.
- [ ] Run the dashboard source test.

### Task 3: Digital Interviewer Speech

**Files:**
- Modify: `components/practice/DigitalInterviewerVideo.tsx`
- Test: `tests/unit/digital-interviewer-video.test.tsx`

- [ ] Write a failing test that expects `朗读问题`, `暂停朗读`, `重播`, and `浏览器语音`.
- [ ] Convert the component to a client component using browser `speechSynthesis`.
- [ ] Add speaking/listening state controls and keep the current visual avatar.
- [ ] Run the focused component test.

### Task 4: Provider-Ready Interface Routes

**Files:**
- Create: `app/api/digital-human/speech/route.ts`
- Create: `app/api/digital-human/render/route.ts`
- Create: `app/api/behavior-analysis/route.ts`
- Test: `tests/unit/digital-human-interface-routes.test.ts`

- [ ] Write failing route tests for speech, render, and behavior-analysis interfaces.
- [ ] Implement Zod-validated POST routes that return provider-ready payloads and current fallback mode.
- [ ] Return clear `mode` values: `BROWSER_TTS_FALLBACK`, `CLIENT_RENDER_FALLBACK`, `LOCAL_SIGNAL_SUMMARY`.
- [ ] Run the focused route test.

### Task 5: Candidate Behavior Signals

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/ai/types.ts`
- Modify: `components/practice/CandidateMediaPanel.tsx`
- Modify: `components/practice/InterviewRoom.tsx`
- Modify: `app/api/sessions/[sessionId]/answer/route.ts`
- Modify: `app/api/sessions/[sessionId]/complete/route.ts`
- Test: `tests/unit/behavior-signals.test.ts`
- Test: `tests/unit/session-api.test.ts`

- [ ] Write failing tests that answer submissions accept `behaviorSignals` and reports receive those signals.
- [ ] Add `behaviorSignalsJson` to `SessionTurn`.
- [ ] Track answer duration, transcript length, microphone level, long pauses, media readiness, and camera readiness.
- [ ] Submit behavior signals with each answer.
- [ ] Include behavior signals in `generateFollowUpCoaching` and `generateCoachingReport`.
- [ ] Run focused API tests and Prisma generation.

### Task 6: Report Behavior Evidence

**Files:**
- Modify: `lib/ai/types.ts`
- Modify: `lib/ai/openAiCompatibleProvider.ts`
- Modify: `lib/ai/mockProvider.ts`
- Modify: `components/practice/CandidateReport.tsx`
- Modify: `components/admin/ReportView.tsx`
- Test: `tests/unit/reports.test.ts`
- Test: `tests/unit/candidate-report.test.tsx`
- Test: `tests/unit/admin-report-view.test.tsx`

- [ ] Write failing tests expecting behavior evidence in report output.
- [ ] Add `behaviorEvidence` to report details.
- [ ] Teach prompts to use behavior signals as observable evidence only.
- [ ] Render behavior evidence in candidate and admin reports.
- [ ] Run focused report tests.

### Task 7: Interface Usage Documentation

**Files:**
- Create: `docs/digital-human-and-behavior-interfaces.md`

- [ ] Document `/api/digital-human/speech`, `/api/digital-human/render`, and `/api/behavior-analysis`.
- [ ] Include request/response examples and provider replacement notes.
- [ ] Explain how current browser TTS fallback works and how to move to paid providers.

### Task 8: Verification and Versioning

**Files:**
- Modify only files changed by previous tasks.

- [ ] Run `npm.cmd run db:generate`.
- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run build`.
- [ ] Run Docker build/start smoke test if Docker Engine is available.
- [ ] Commit and push with a timestamped message.

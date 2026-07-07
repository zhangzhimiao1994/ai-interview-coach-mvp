# AI Service Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin AI service configuration center for providers, models, and per-capability defaults.

**Architecture:** Store provider/model configuration in Prisma SQLite. Use small domain helpers for secret masking/encryption and default routing. Expose REST routes under `/api/ai-services` and render a server-backed admin page at `/admin/ai-services`.

**Tech Stack:** Next.js App Router, React, Prisma, SQLite, Node crypto, Zod, Vitest.

---

### Task 1: Data Model And Domain Helpers

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/domain/aiServices.ts`
- Test: `tests/unit/ai-services.test.ts`

- [ ] Add `AiServiceProvider` and `AiModelConfig` models.
- [ ] Add helper functions for API key masking and encryption.
- [ ] Add helper function that enforces one default model per capability.

### Task 2: API Routes

**Files:**
- Create: `app/api/ai-services/providers/route.ts`
- Create: `app/api/ai-services/models/route.ts`
- Create: `lib/validators/aiServices.ts`
- Test: `tests/unit/ai-service-routes.test.ts`

- [ ] Add provider creation/listing route with validation.
- [ ] Add model creation/listing route with validation.
- [ ] Hide raw encrypted secrets from API responses.

### Task 3: Admin UI

**Files:**
- Create: `app/admin/ai-services/page.tsx`
- Create: `components/admin/AiServiceConfigPanel.tsx`
- Modify: `app/admin/page.tsx`

- [ ] Add an admin dashboard link.
- [ ] Add provider form.
- [ ] Add model form.
- [ ] Show enabled providers, models, masked key previews, and default badges.

### Task 4: Runtime And Verification

**Files:**
- Modify: `lib/ai/providerFactory.ts`
- Modify: `.env.example`

- [ ] Add DB-backed configuration metadata lookup while preserving mock fallback.
- [ ] Add `AI_CONFIG_SECRET` example.
- [ ] Run `npm test`, `npm run build`, and `npm run test:e2e`.
- [ ] Commit and push with a timestamped message.

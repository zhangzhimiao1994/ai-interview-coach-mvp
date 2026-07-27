# Automated Recruitment Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recruitment job library that can ingest job postings through manual import, aggregated job APIs, official/public job sources, and prepared browser authorization records.

**Architecture:** Add a recruitment domain with Prisma-backed sources, search templates, postings, sync runs, and schedules. Keep collection separate from interview sessions: connectors write normalized postings into the job library, and training tasks copy a snapshot from the selected posting. Browser collection is introduced through secure source/session records first; real login-gated connectors are enabled only after authorized accounts are available.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma SQLite, Vitest, Zod, Node `crypto`, existing admin session/auth patterns.

---

## Global Constraints

- Repository remains `zhangzhimiao1994/ai-interview-coach-mvp`.
- Branch remains `feature/alibaba-multimodal-integration`.
- Display name remains `开发面试数字人`.
- Do not stage or commit root `new-project-handoff-2026-07-16.md`.
- Do not commit `.env`, credentials, database files, browser sessions, logs, API responses with secrets, or Docker runtime data.
- Do not add product mock behavior. Tests may use deterministic local fixtures, sanitized real payloads, local SQLite test databases, and dependency injection, but runtime code must call real source connectors.
- After each completed task: run the listed tests, commit, and push to GitHub.
- If Docker is used for verification, stop containers and Docker after debugging.

## File Structure

- Create `lib/recruitment/types.ts`: shared enums, input/output types, and connector interfaces.
- Create `lib/recruitment/crypto.ts`: encryption/decryption for recruitment API credentials and browser session state using `RECRUITMENT_SESSION_SECRET`.
- Create `lib/recruitment/normalization.ts`: text normalization, canonical URL handling, content hash, dedupe key helpers.
- Create `lib/recruitment/postings.ts`: manual import validation, normalized posting creation, training task snapshot helpers.
- Create `lib/recruitment/connectors/base.ts`: connector registry and failure classification helpers.
- Create `lib/recruitment/connectors/adzuna.ts`: Adzuna API connector.
- Create `lib/recruitment/connectors/jooble.ts`: Jooble API connector.
- Create `lib/recruitment/connectors/greenhouse.ts`: Greenhouse public board connector.
- Create `lib/recruitment/connectors/lever.ts`: Lever public posting connector.
- Create `lib/recruitment/connectors/usajobs.ts`: USAJOBS official API connector.
- Create `lib/recruitment/sync.ts`: sync orchestration, source/template loading, run logging, idempotent upsert.
- Create `lib/validators/recruitment.ts`: Zod validators for admin API requests.
- Modify `prisma/schema.prisma`: add recruitment models and link job postings to training tasks.
- Create migrations under `prisma/migrations`.
- Create `app/api/recruitment/sources/route.ts`.
- Create `app/api/recruitment/sources/[sourceId]/route.ts`.
- Create `app/api/recruitment/templates/route.ts`.
- Create `app/api/recruitment/postings/route.ts`.
- Create `app/api/recruitment/postings/[postingId]/route.ts`.
- Create `app/api/recruitment/sync-runs/route.ts`.
- Create `app/admin/recruitment/page.tsx`.
- Create `components/admin/recruitment/RecruitmentSourcePanel.tsx`.
- Create `components/admin/recruitment/RecruitmentTemplatePanel.tsx`.
- Create `components/admin/recruitment/RecruitmentJobLibraryPanel.tsx`.
- Create `components/admin/recruitment/RecruitmentSyncRunPanel.tsx`.
- Modify `components/admin/AdminShell.tsx`: add recruitment navigation item.
- Modify `components/admin/TrainingTaskForm.tsx`: allow selecting a job library posting and copying its snapshot.
- Modify `app/api/tasks/route.ts` and `lib/validators/task.ts`: accept `jobPostingId` and snapshot fields.
- Add focused tests in `tests/unit/recruitment-*.test.ts`.

---

### Task 1: Recruitment Data Model and Encryption

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260727120000_add_recruitment_collection/migration.sql`
- Create: `lib/recruitment/types.ts`
- Create: `lib/recruitment/crypto.ts`
- Create: `lib/recruitment/normalization.ts`
- Test: `tests/unit/recruitment-normalization.test.ts`
- Test: `tests/unit/recruitment-crypto.test.ts`
- Test: `tests/unit/recruitment-migration.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `tests/unit/recruitment-normalization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRecruitmentDedupeKey, canonicalizeJobUrl, hashRecruitmentContent, normalizeRecruitmentText } from "@/lib/recruitment/normalization";

describe("recruitment normalization", () => {
  it("normalizes text and canonicalizes job urls", () => {
    expect(normalizeRecruitmentText(" Senior  Engineer \r\n\r\n React ")).toBe("Senior Engineer\n\nReact");
    expect(canonicalizeJobUrl("https://boards.greenhouse.io/acme/jobs/123?gh_src=x#app")).toBe("https://boards.greenhouse.io/acme/jobs/123");
  });

  it("builds stable dedupe keys from external id, url, then content hash", () => {
    expect(buildRecruitmentDedupeKey({ provider: "greenhouse", externalJobId: "123" })).toBe("provider:greenhouse:123");
    expect(buildRecruitmentDedupeKey({ provider: "manual", sourceUrl: "https://jobs.example.com/a?utm_source=x" })).toBe("url:https://jobs.example.com/a");
    expect(buildRecruitmentDedupeKey({ provider: "manual", title: "Backend", company: "Acme", description: "Build APIs" })).toBe(`hash:${hashRecruitmentContent("Backend\nAcme\nBuild APIs")}`);
  });
});
```

- [ ] **Step 2: Write failing crypto tests**

Create `tests/unit/recruitment-crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptRecruitmentSecret, encryptRecruitmentSecret, getRecruitmentSecretPreview } from "@/lib/recruitment/crypto";

describe("recruitment credential encryption", () => {
  it("encrypts values without leaking plaintext and decrypts with the same secret", () => {
    const encrypted = encryptRecruitmentSecret("adzuna-key-123456", "0123456789abcdef0123456789abcdef");
    expect(encrypted.ciphertext).not.toContain("adzuna-key");
    expect(encrypted.iv).toHaveLength(24);
    expect(encrypted.tag).toHaveLength(24);
    expect(decryptRecruitmentSecret(encrypted, "0123456789abcdef0123456789abcdef")).toBe("adzuna-key-123456");
    expect(getRecruitmentSecretPreview("adzuna-key-123456")).toBe("adzu...3456");
  });
});
```

- [ ] **Step 3: Write failing migration shape test**

Create `tests/unit/recruitment-migration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("recruitment migration", () => {
  it("creates recruitment tables, indexes, and training task link", () => {
    const sql = readFileSync("prisma/migrations/20260727120000_add_recruitment_collection/migration.sql", "utf8");
    expect(sql).toContain("CREATE TABLE \"RecruitmentSource\"");
    expect(sql).toContain("CREATE TABLE \"RecruitmentJobPosting\"");
    expect(sql).toContain("CREATE TABLE \"RecruitmentSyncRun\"");
    expect(sql).toContain("ALTER TABLE \"TrainingTask\" ADD COLUMN \"jobPostingId\" TEXT");
    expect(sql).toContain("CREATE UNIQUE INDEX \"RecruitmentJobPosting_provider_externalJobId_key\"");
  });
});
```

- [ ] **Step 4: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-normalization.test.ts tests/unit/recruitment-crypto.test.ts tests/unit/recruitment-migration.test.ts`

Expected: fail because recruitment modules and migration do not exist.

- [ ] **Step 5: Add Prisma models and migration**

Add models to `prisma/schema.prisma` with string statuses to match existing project style:

```prisma
model RecruitmentSource {
  id                         String   @id @default(cuid())
  provider                   String
  sourceType                 String
  displayName                String
  enabled                    Boolean  @default(true)
  credentialCiphertext       String?
  credentialIv               String?
  credentialTag              String?
  credentialPreview          String?
  sessionCiphertext          String?
  sessionIv                  String?
  sessionTag                 String?
  sessionPreview             String?
  verificationStatus         String   @default("UNVERIFIED")
  lastVerifiedAt             DateTime?
  lastSuccessfulSyncAt       DateTime?
  settingsJson               String   @default("{}")
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
  postings                   RecruitmentJobPosting[]
  syncRuns                   RecruitmentSyncRun[]

  @@index([provider])
  @@index([sourceType])
  @@index([enabled])
  @@unique([provider, displayName])
}
```

Also add `RecruitmentSearchTemplate`, `RecruitmentTemplateCandidate`, `RecruitmentSyncSchedule`, `RecruitmentSyncRun`, and `RecruitmentJobPosting`. Add `jobPostingId String?` and `jobPosting RecruitmentJobPosting?` to `TrainingTask`.

- [ ] **Step 6: Implement shared recruitment types**

Create `lib/recruitment/types.ts`:

```ts
export const recruitmentSourceTypes = ["AGGREGATED_API", "PUBLIC_SOURCE", "AUTHORIZED_BROWSER", "MANUAL"] as const;
export type RecruitmentSourceType = typeof recruitmentSourceTypes[number];

export const recruitmentRunStatuses = ["PENDING", "RUNNING", "SUCCESS", "PARTIAL", "AUTH_REQUIRED", "RATE_LIMITED", "SOURCE_UNAVAILABLE", "PARSER_CHANGED", "FAILED", "PAUSED"] as const;
export type RecruitmentRunStatus = typeof recruitmentRunStatuses[number];

export type NormalizedRecruitmentPostingInput = {
  provider: string;
  sourceType: RecruitmentSourceType;
  title: string;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  description: string;
  requirements?: string[];
  sourceUrl?: string | null;
  externalJobId?: string | null;
  publishedAt?: Date | null;
  rawJson?: unknown;
};
```

- [ ] **Step 7: Implement normalization helpers**

Create `lib/recruitment/normalization.ts` with `normalizeRecruitmentText`, `canonicalizeJobUrl`, `hashRecruitmentContent`, and `buildRecruitmentDedupeKey`. Strip tracking query params beginning with `utm_`, `gh_src`, `lever-source`, and fragments.

- [ ] **Step 8: Implement encryption helpers**

Create `lib/recruitment/crypto.ts` using AES-256-GCM. Derive a 32-byte key from `RECRUITMENT_SESSION_SECRET` through SHA-256. Export `encryptRecruitmentSecret`, `decryptRecruitmentSecret`, and `getRecruitmentSecretPreview`. Throw `RECRUITMENT_SESSION_SECRET_REQUIRED` when the provided or environment secret is shorter than 32 characters.

- [ ] **Step 9: Run Task 1 tests**

Run: `npm.cmd test -- tests/unit/recruitment-normalization.test.ts tests/unit/recruitment-crypto.test.ts tests/unit/recruitment-migration.test.ts`

Expected: PASS.

- [ ] **Step 10: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add prisma/schema.prisma prisma/migrations/20260727120000_add_recruitment_collection/migration.sql lib/recruitment/types.ts lib/recruitment/crypto.ts lib/recruitment/normalization.ts tests/unit/recruitment-normalization.test.ts tests/unit/recruitment-crypto.test.ts tests/unit/recruitment-migration.test.ts
git commit -m "feat: add recruitment collection data model"
git push
```

Expected: commit and push succeed.

---

### Task 2: Manual Import and Job Library Domain

**Files:**
- Create: `lib/recruitment/postings.ts`
- Create: `lib/validators/recruitment.ts`
- Create: `app/api/recruitment/postings/route.ts`
- Create: `app/api/recruitment/postings/[postingId]/route.ts`
- Modify: `lib/validators/task.ts`
- Modify: `app/api/tasks/route.ts`
- Test: `tests/unit/recruitment-postings.test.ts`
- Test: `tests/unit/recruitment-posting-routes.test.ts`
- Test: `tests/unit/recruitment-task-snapshot.test.ts`

- [ ] **Step 1: Write failing manual posting domain tests**

Create `tests/unit/recruitment-postings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createManualRecruitmentPostingInput, toTrainingTaskJobSnapshot } from "@/lib/recruitment/postings";

describe("manual recruitment postings", () => {
  it("normalizes manual import into a job library posting", () => {
    const posting = createManualRecruitmentPostingInput({
      title: "Senior Frontend Engineer",
      company: "Acme",
      location: "Remote",
      salary: "50k-70k",
      description: "Build interview products.",
      requirementsText: "React\nTypeScript",
      sourceUrl: "https://jobs.example.com/role?utm_source=test",
      notes: "Ask about real-time UI."
    });
    expect(posting.provider).toBe("manual");
    expect(posting.sourceType).toBe("MANUAL");
    expect(posting.requirements).toEqual(["React", "TypeScript"]);
    expect(posting.sourceUrl).toBe("https://jobs.example.com/role");
  });

  it("copies an immutable snapshot for training tasks", () => {
    const snapshot = toTrainingTaskJobSnapshot({
      id: "job-1",
      title: "Backend Engineer",
      company: "Acme",
      sourceUrl: "https://jobs.example.com/backend",
      description: "Own APIs.",
      requirementsJson: JSON.stringify(["Node.js"]),
      editedNotes: "Probe API design."
    });
    expect(snapshot).toEqual({
      jobPostingId: "job-1",
      targetRole: "Backend Engineer",
      targetCompany: "Acme",
      jobSourceUrl: "https://jobs.example.com/backend",
      jobDescription: "Own APIs.\n\nRequirements:\n- Node.js",
      jobManualNotes: "Probe API design."
    });
  });
});
```

- [ ] **Step 2: Write failing validator and route tests**

Create `tests/unit/recruitment-posting-routes.test.ts` using the same style as existing route tests. Exercise:

```ts
expect(() => parseManualRecruitmentPostingInput({ title: "", description: "x" })).toThrow();
expect(parseManualRecruitmentPostingInput({ title: "Frontend", description: "Build UI" })).toMatchObject({
  title: "Frontend",
  provider: "manual"
});
```

Route tests should call the exported `POST` handler with a manual payload and assert status `201` and redacted response fields.

- [ ] **Step 3: Write failing training task snapshot test**

Create `tests/unit/recruitment-task-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTrainingTaskInput } from "@/lib/validators/task";

describe("training task recruitment snapshot", () => {
  it("accepts a selected job posting id with copied job fields", () => {
    const parsed = parseTrainingTaskInput({
      candidateId: "candidate-1",
      title: "Practice",
      targetCompany: "Acme",
      targetRole: "Frontend",
      jobPostingId: "posting-1",
      jobSourceUrl: "https://jobs.example.com/frontend",
      jobDescription: "Build UI",
      jobManualNotes: "Ask state management.",
      expectedMinutes: 30,
      stageConfig: [{ type: "INTRO", enabled: true, durationMinutes: 3, visibleTransition: true }]
    });
    expect(parsed.jobPostingId).toBe("posting-1");
    expect(parsed.jobDescription).toContain("Build UI");
  });
});
```

- [ ] **Step 4: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-postings.test.ts tests/unit/recruitment-posting-routes.test.ts tests/unit/recruitment-task-snapshot.test.ts`

Expected: fail because posting domain, validators, and routes do not exist.

- [ ] **Step 5: Implement posting domain**

Create `lib/recruitment/postings.ts` with:

```ts
export function splitRequirementsText(value?: string | null) {
  return (value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
```

Add `createManualRecruitmentPostingInput`, `normalizeConnectorPostingInput`, `serializeRecruitmentPosting`, and `toTrainingTaskJobSnapshot`. Keep `rawJson` stored as JSON text and never include credentials.

- [ ] **Step 6: Implement validators**

Create `lib/validators/recruitment.ts` with `parseManualRecruitmentPostingInput`, `parseRecruitmentPostingUpdateInput`, `parseRecruitmentPostingListQuery`, and source URL validation using `canonicalizeJobUrl`.

- [ ] **Step 7: Implement posting API routes**

`POST /api/recruitment/postings` creates a manual posting and upserts by dedupe key. `GET /api/recruitment/postings` lists newest postings with filters for provider, source type, company, keyword, and candidate-ready status. `PATCH /api/recruitment/postings/[postingId]` updates edited fields. `DELETE` disables or archives a posting through `status = "ARCHIVED"` instead of deleting source history.

- [ ] **Step 8: Update training task input**

Add `jobPostingId` to `trainingTaskInputSchema` as an optional ID. The form/API sends copied snapshot fields; the task remains stable even if the library posting changes.

- [ ] **Step 9: Run Task 2 tests**

Run: `npm.cmd test -- tests/unit/recruitment-postings.test.ts tests/unit/recruitment-posting-routes.test.ts tests/unit/recruitment-task-snapshot.test.ts tests/unit/task-validator.test.ts tests/unit/job-posting-import-route.test.ts`

Expected: PASS.

- [ ] **Step 10: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add lib/recruitment/postings.ts lib/validators/recruitment.ts app/api/recruitment/postings app/api/tasks/route.ts lib/validators/task.ts tests/unit/recruitment-postings.test.ts tests/unit/recruitment-posting-routes.test.ts tests/unit/recruitment-task-snapshot.test.ts
git commit -m "feat: add manual recruitment job library"
git push
```

Expected: commit and push succeed.

---

### Task 3: Recruitment Sources, Search Templates, and Admin APIs

**Files:**
- Create: `app/api/recruitment/sources/route.ts`
- Create: `app/api/recruitment/sources/[sourceId]/route.ts`
- Create: `app/api/recruitment/templates/route.ts`
- Create: `app/api/recruitment/templates/[templateId]/route.ts`
- Extend: `lib/validators/recruitment.ts`
- Test: `tests/unit/recruitment-source-routes.test.ts`
- Test: `tests/unit/recruitment-template-routes.test.ts`
- Test: `tests/unit/recruitment-source-security.test.ts`

- [ ] **Step 1: Write failing source validator/security tests**

Create `tests/unit/recruitment-source-security.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRecruitmentSourceInput, serializeRecruitmentSource } from "@/lib/validators/recruitment";

describe("recruitment source security", () => {
  it("accepts aggregated API credentials but serializes only preview values", () => {
    const input = parseRecruitmentSourceInput({
      provider: "adzuna",
      sourceType: "AGGREGATED_API",
      displayName: "Adzuna US",
      apiKey: "adzuna-secret-key-1234567890",
      settings: { appId: "app-1", country: "us" }
    });
    expect(input.apiKey).toBe("adzuna-secret-key-1234567890");
    const serialized = serializeRecruitmentSource({
      id: "source-1",
      provider: "adzuna",
      sourceType: "AGGREGATED_API",
      displayName: "Adzuna US",
      enabled: true,
      credentialPreview: "adzu...7890",
      verificationStatus: "UNVERIFIED",
      lastVerifiedAt: null,
      lastSuccessfulSyncAt: null,
      settingsJson: JSON.stringify({ country: "us" }),
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z")
    });
    expect(JSON.stringify(serialized)).not.toContain("adzuna-secret-key");
  });
});
```

- [ ] **Step 2: Write failing route tests**

Create route tests proving `POST /api/recruitment/sources` creates encrypted source rows, `PATCH` toggles enabled state, and `POST /api/recruitment/templates` stores selected providers and candidate bindings as JSON or relation rows.

- [ ] **Step 3: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-source-security.test.ts tests/unit/recruitment-source-routes.test.ts tests/unit/recruitment-template-routes.test.ts`

Expected: fail because source/template validators and routes do not exist.

- [ ] **Step 4: Implement source validators**

Add `parseRecruitmentSourceInput`, `parseRecruitmentSourcePatchInput`, and `serializeRecruitmentSource`. Required fields:

```ts
{
  provider: z.enum(["adzuna", "jooble", "greenhouse", "lever", "usajobs", "manual", "boss", "liepin", "zhaopin", "linkedin"]),
  sourceType: z.enum(["AGGREGATED_API", "PUBLIC_SOURCE", "AUTHORIZED_BROWSER", "MANUAL"]),
  displayName: z.string().trim().min(1),
  apiKey: z.string().trim().min(16).optional(),
  sessionState: z.string().trim().min(16).optional(),
  settings: z.record(z.unknown()).default({})
}
```

- [ ] **Step 5: Implement source routes**

Use `encryptRecruitmentSecret` for `apiKey` and `sessionState`. Store previews only in response. `DELETE` clears encrypted credentials/session and disables the source. Keep route responses aligned with `serializeRecruitmentSource`.

- [ ] **Step 6: Implement template validators and routes**

Search templates accept keywords, role type, city, country, experience range, salary range, language, remote mode, selected source IDs, enabled status, and candidate IDs. Store multi-value filters as JSON strings following the existing schema style.

- [ ] **Step 7: Run Task 3 tests**

Run: `npm.cmd test -- tests/unit/recruitment-source-security.test.ts tests/unit/recruitment-source-routes.test.ts tests/unit/recruitment-template-routes.test.ts tests/unit/security.test.ts`

Expected: PASS.

- [ ] **Step 8: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add app/api/recruitment/sources app/api/recruitment/templates lib/validators/recruitment.ts tests/unit/recruitment-source-security.test.ts tests/unit/recruitment-source-routes.test.ts tests/unit/recruitment-template-routes.test.ts
git commit -m "feat: add recruitment source management APIs"
git push
```

Expected: commit and push succeed.

---

### Task 4: Connector Framework and Public/API Connectors

**Files:**
- Create: `lib/recruitment/connectors/base.ts`
- Create: `lib/recruitment/connectors/adzuna.ts`
- Create: `lib/recruitment/connectors/jooble.ts`
- Create: `lib/recruitment/connectors/greenhouse.ts`
- Create: `lib/recruitment/connectors/lever.ts`
- Create: `lib/recruitment/connectors/usajobs.ts`
- Create: `lib/recruitment/connectors/index.ts`
- Test: `tests/unit/recruitment-connectors.test.ts`
- Test: `tests/unit/recruitment-public-connectors.test.ts`

- [ ] **Step 1: Verify official connector docs before coding**

Use official docs only for request shape and required headers:

```text
Adzuna: https://developer.adzuna.com/overview
Jooble: https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation
USAJOBS: https://developer.usajobs.gov/api-reference/get-api-search
Greenhouse: public board JSON endpoints and public job pages
Lever: public postings endpoints and public job pages
```

Expected: endpoint shape and credential requirements are recorded in comments inside connector tests or test fixture names, not in runtime logs.

- [ ] **Step 2: Write failing connector contract tests**

Create `tests/unit/recruitment-connectors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyRecruitmentFailure, createRecruitmentConnectorRegistry } from "@/lib/recruitment/connectors/base";

describe("recruitment connector framework", () => {
  it("maps connector failures to platform statuses", () => {
    expect(classifyRecruitmentFailure({ status: 401, message: "unauthorized" })).toBe("AUTH_REQUIRED");
    expect(classifyRecruitmentFailure({ status: 429, message: "rate limited" })).toBe("RATE_LIMITED");
    expect(classifyRecruitmentFailure({ status: 503, message: "unavailable" })).toBe("SOURCE_UNAVAILABLE");
    expect(classifyRecruitmentFailure({ status: 200, message: "shape changed" })).toBe("PARSER_CHANGED");
  });

  it("registers supported non-browser connectors", () => {
    const registry = createRecruitmentConnectorRegistry();
    expect(registry.listProviders()).toEqual(expect.arrayContaining(["adzuna", "jooble", "greenhouse", "lever", "usajobs"]));
  });
});
```

- [ ] **Step 3: Write failing public connector normalization tests**

Create `tests/unit/recruitment-public-connectors.test.ts` with sanitized real-shaped payloads:

```ts
it("normalizes an Adzuna search result", async () => {
  const connector = createAdzunaConnector({ fetch: async () => new Response(JSON.stringify({
    results: [{ id: "a1", title: "Frontend Engineer", company: { display_name: "Acme" }, location: { display_name: "Remote" }, description: "Build React apps", redirect_url: "https://www.adzuna.com/job/a1" }]
  })) });
  const result = await connector.search(sourceWithCredentials(), template("react"));
  expect(result.postings[0]).toMatchObject({ provider: "adzuna", externalJobId: "a1", title: "Frontend Engineer" });
});
```

Add equivalent tests for Jooble, Greenhouse, Lever, and USAJOBS using public response shapes. These are fixtures, not runtime mocks.

- [ ] **Step 4: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-connectors.test.ts tests/unit/recruitment-public-connectors.test.ts`

Expected: fail because connector modules do not exist.

- [ ] **Step 5: Implement connector contract**

`base.ts` exports:

```ts
export type RecruitmentConnector = {
  provider: string;
  sourceType: "AGGREGATED_API" | "PUBLIC_SOURCE" | "AUTHORIZED_BROWSER";
  verify(source: ConnectorSource): Promise<ConnectorVerification>;
  search(source: ConnectorSource, template: ConnectorSearchTemplate): Promise<ConnectorSearchResult>;
};
```

Also export `createRecruitmentConnectorRegistry`, `classifyRecruitmentFailure`, `redactRecruitmentLog`, and `buildSearchUrl`.

- [ ] **Step 6: Implement Adzuna and Jooble connectors**

Adzuna uses configured `appId`, encrypted API key, country, keyword, location, page, and page size. Jooble posts keyword/location filters with API key. Both return normalized postings and never log full request URLs containing keys.

- [ ] **Step 7: Implement Greenhouse, Lever, and USAJOBS connectors**

Greenhouse and Lever work with company board identifiers or public posting URLs configured in source settings. USAJOBS uses configured API key, user agent/email setting, keyword, location, and result limits.

- [ ] **Step 8: Run Task 4 tests**

Run: `npm.cmd test -- tests/unit/recruitment-connectors.test.ts tests/unit/recruitment-public-connectors.test.ts tests/unit/recruitment-normalization.test.ts`

Expected: PASS.

- [ ] **Step 9: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add lib/recruitment/connectors tests/unit/recruitment-connectors.test.ts tests/unit/recruitment-public-connectors.test.ts
git commit -m "feat: add recruitment source connectors"
git push
```

Expected: commit and push succeed.

---

### Task 5: Sync Orchestration and Run History

**Files:**
- Create: `lib/recruitment/sync.ts`
- Create: `app/api/recruitment/sync-runs/route.ts`
- Create: `app/api/recruitment/sync-runs/[runId]/route.ts`
- Extend: `lib/validators/recruitment.ts`
- Test: `tests/unit/recruitment-sync.test.ts`
- Test: `tests/unit/recruitment-sync-routes.test.ts`

- [ ] **Step 1: Write failing sync tests**

Create `tests/unit/recruitment-sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runRecruitmentSync } from "@/lib/recruitment/sync";

describe("recruitment sync", () => {
  it("upserts connector postings and records a successful run", async () => {
    const result = await runRecruitmentSync({
      prisma: sqliteRecruitmentTestClient(),
      connectorRegistry: registryWithRealShapeFixtureConnector(),
      templateId: "template-1",
      sourceIds: ["source-1"],
      now: () => new Date("2026-07-27T12:00:00.000Z")
    });
    expect(result.status).toBe("SUCCESS");
    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
  });

  it("redacts secrets and marks authorization failures", async () => {
    const result = await runRecruitmentSync({
      prisma: sqliteRecruitmentTestClient(),
      connectorRegistry: registryWithUnauthorizedConnector("secret-api-key"),
      templateId: "template-1",
      sourceIds: ["source-1"]
    });
    expect(result.status).toBe("AUTH_REQUIRED");
    expect(JSON.stringify(result.logs)).not.toContain("secret-api-key");
  });
});
```

- [ ] **Step 2: Write failing sync route tests**

Create `tests/unit/recruitment-sync-routes.test.ts` proving `POST /api/recruitment/sync-runs` starts a manual sync with a template ID and source IDs, and `GET` lists recent redacted runs.

- [ ] **Step 3: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-sync.test.ts tests/unit/recruitment-sync-routes.test.ts`

Expected: fail because sync orchestration does not exist.

- [ ] **Step 4: Implement sync orchestration**

`runRecruitmentSync` loads the search template, loads enabled sources, creates a `RUNNING` run, calls each connector, upserts postings by dedupe key, updates `lastSeenAt`, stores redacted logs, and finishes with `SUCCESS`, `PARTIAL`, or the classified failure status.

- [ ] **Step 5: Implement sync APIs**

`POST /api/recruitment/sync-runs` accepts `templateId`, optional `sourceIds`, and `mode: "MANUAL"`. `GET` returns recent runs ordered by newest first. `GET /api/recruitment/sync-runs/[runId]` returns run details with logs already redacted.

- [ ] **Step 6: Run Task 5 tests**

Run: `npm.cmd test -- tests/unit/recruitment-sync.test.ts tests/unit/recruitment-sync-routes.test.ts tests/unit/recruitment-public-connectors.test.ts`

Expected: PASS.

- [ ] **Step 7: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add lib/recruitment/sync.ts app/api/recruitment/sync-runs lib/validators/recruitment.ts tests/unit/recruitment-sync.test.ts tests/unit/recruitment-sync-routes.test.ts
git commit -m "feat: add recruitment sync orchestration"
git push
```

Expected: commit and push succeed.

---

### Task 6: Admin Recruitment UI and Training Task Selection

**Files:**
- Create: `app/admin/recruitment/page.tsx`
- Create: `components/admin/recruitment/RecruitmentSourcePanel.tsx`
- Create: `components/admin/recruitment/RecruitmentTemplatePanel.tsx`
- Create: `components/admin/recruitment/RecruitmentJobLibraryPanel.tsx`
- Create: `components/admin/recruitment/RecruitmentSyncRunPanel.tsx`
- Modify: `components/admin/AdminShell.tsx`
- Modify: `components/admin/TrainingTaskForm.tsx`
- Modify: `app/admin/tasks/new/page.tsx`
- Test: `tests/unit/recruitment-admin-ui.test.tsx`
- Test: `tests/unit/recruitment-training-task-ui.test.tsx`
- Test: `tests/unit/admin-navigation.test.ts`

- [ ] **Step 1: Write failing admin UI tests**

Create `tests/unit/recruitment-admin-ui.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecruitmentJobLibraryPanel } from "@/components/admin/recruitment/RecruitmentJobLibraryPanel";

describe("recruitment admin UI", () => {
  it("shows manual import, sources, templates, job library, and sync runs", () => {
    render(<RecruitmentJobLibraryPanel postings={[]} />);
    expect(screen.getByRole("button", { name: /Manual import/i })).toBeTruthy();
    expect(screen.getByText(/Job library/i)).toBeTruthy();
  });
});
```

Extend navigation tests to expect a recruitment nav item.

- [ ] **Step 2: Write failing training task UI test**

Create `tests/unit/recruitment-training-task-ui.test.tsx` proving the new task form renders a job posting select, fills target company/role/JD when selected, and still allows free manual JD input.

- [ ] **Step 3: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-admin-ui.test.tsx tests/unit/recruitment-training-task-ui.test.tsx tests/unit/admin-navigation.test.ts`

Expected: fail because UI components do not exist.

- [ ] **Step 4: Add recruitment admin page**

`app/admin/recruitment/page.tsx` uses `AdminShell active="recruitment"` and server-loads sources, templates, postings, and recent sync runs. Keep the interface dense and operational: tabs or compact sections, not a marketing page.

- [ ] **Step 5: Add recruitment panels**

Source panel supports provider dropdown, custom provider fallback, API key/session status fields, enable toggle, and credential preview. Template panel supports search filters and source selection. Job library panel supports manual import, edit, merge/archive actions, and create-training-task action. Sync run panel supports immediate sync and redacted failure display.

- [ ] **Step 6: Add task form posting selection**

`app/admin/tasks/new/page.tsx` passes recent active job postings to `TrainingTaskForm`. Selecting a posting copies title/company/source URL/description/notes into the existing fields before submit. The copied snapshot is sent with `jobPostingId`.

- [ ] **Step 7: Run Task 6 tests**

Run: `npm.cmd test -- tests/unit/recruitment-admin-ui.test.tsx tests/unit/recruitment-training-task-ui.test.tsx tests/unit/admin-navigation.test.ts tests/unit/job-posting-import-ui.test.ts`

Expected: PASS.

- [ ] **Step 8: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add app/admin/recruitment components/admin/recruitment components/admin/AdminShell.tsx components/admin/TrainingTaskForm.tsx app/admin/tasks/new/page.tsx tests/unit/recruitment-admin-ui.test.tsx tests/unit/recruitment-training-task-ui.test.tsx tests/unit/admin-navigation.test.ts
git commit -m "feat: add recruitment admin workspace"
git push
```

Expected: commit and push succeed.

---

### Task 7: Browser Authorization Records and Scheduled Sync Foundation

**Files:**
- Create: `app/api/recruitment/sources/[sourceId]/authorization/route.ts`
- Create: `lib/recruitment/browserSessions.ts`
- Extend: `lib/recruitment/sync.ts`
- Extend: `lib/validators/recruitment.ts`
- Test: `tests/unit/recruitment-browser-session.test.ts`
- Test: `tests/unit/recruitment-schedule.test.ts`

- [ ] **Step 1: Write failing browser session tests**

Create `tests/unit/recruitment-browser-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyBrowserAuthorizationState, sanitizeBrowserSessionPreview } from "@/lib/recruitment/browserSessions";

describe("recruitment browser session records", () => {
  it("redacts browser storage and classifies authorization states", () => {
    const state = JSON.stringify({ cookies: [{ name: "sid", value: "secret-cookie" }], origins: [] });
    expect(sanitizeBrowserSessionPreview(state)).toBe("browser-session:1-cookie:0-origin");
    expect(classifyBrowserAuthorizationState({ hasSession: false, verificationStatus: "UNVERIFIED" })).toBe("AUTH_REQUIRED");
    expect(classifyBrowserAuthorizationState({ hasSession: true, verificationStatus: "VERIFIED" })).toBe("READY");
  });
});
```

- [ ] **Step 2: Write failing schedule tests**

Create `tests/unit/recruitment-schedule.test.ts` proving schedules compute the next run time, skip disabled templates, and do not start a second run when an existing run lock has not expired.

- [ ] **Step 3: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/recruitment-browser-session.test.ts tests/unit/recruitment-schedule.test.ts`

Expected: fail because browser session and schedule helpers do not exist.

- [ ] **Step 4: Implement browser session storage helpers**

`browserSessions.ts` validates Playwright storage-state JSON as opaque text, stores it encrypted with `RECRUITMENT_SESSION_SECRET`, produces only a count-based preview, and never exposes cookie values.

- [ ] **Step 5: Implement authorization API records**

`POST /api/recruitment/sources/[sourceId]/authorization` accepts storage-state JSON from a super-admin-controlled authorization flow and stores it encrypted. It does not accept usernames or passwords.

- [ ] **Step 6: Implement schedule foundation**

Add helpers to claim due schedules, compute `nextRunAt`, and call `runRecruitmentSync`. Do not start a background process in this task; wire it so the Linux service or future worker can call the function explicitly.

- [ ] **Step 7: Run Task 7 tests**

Run: `npm.cmd test -- tests/unit/recruitment-browser-session.test.ts tests/unit/recruitment-schedule.test.ts tests/unit/recruitment-source-security.test.ts`

Expected: PASS.

- [ ] **Step 8: Verify, commit, and push**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add app/api/recruitment/sources lib/recruitment/browserSessions.ts lib/recruitment/sync.ts lib/validators/recruitment.ts tests/unit/recruitment-browser-session.test.ts tests/unit/recruitment-schedule.test.ts
git commit -m "feat: add recruitment browser authorization records"
git push
```

Expected: commit and push succeed.

---

### Task 8: Final Verification, Build, and Deployment Notes

**Files:**
- Modify: `scripts/validate-production-env.mjs`
- Modify: `docs/linux-deployment.md`
- Modify: `docs/new-project-handoff-2026-07-16.md`
- Test: `tests/unit/linux-deployment-package.test.ts`
- Test: `tests/unit/security.test.ts`

- [ ] **Step 1: Write failing deployment/security tests**

Extend `tests/unit/linux-deployment-package.test.ts` and `tests/unit/security.test.ts`:

```ts
expect(productionEnvChecklist).toContain("RECRUITMENT_SESSION_SECRET");
expect(productionEnvChecklist).toContain("DATABASE_URL");
expect(renderedDocs).toContain("docker compose down");
```

Also assert that examples never include real API keys or browser session JSON.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test -- tests/unit/linux-deployment-package.test.ts tests/unit/security.test.ts`

Expected: fail because deployment validation/docs do not mention recruitment secrets.

- [ ] **Step 3: Update production env validation**

`scripts/validate-production-env.mjs` requires `RECRUITMENT_SESSION_SECRET` in production with at least 32 characters. The error message must explain it encrypts recruitment API credentials and browser session state.

- [ ] **Step 4: Update deployment docs and handoff**

`docs/linux-deployment.md` documents `RECRUITMENT_SESSION_SECRET`, recruitment source configuration, no password storage, manual import, and Docker shutdown after debugging. `docs/new-project-handoff-2026-07-16.md` records the completed phases and next login-gated connector steps. Do not edit or stage root `new-project-handoff-2026-07-16.md`.

- [ ] **Step 5: Run full verification**

Run: `npm.cmd test`

Expected: all unit tests pass.

Run: `npm.cmd build`

Expected: production build succeeds.

- [ ] **Step 6: Optional Docker verification when requested**

Run only when the user asks for Docker deployment parity debugging:

```bash
docker compose build
docker compose up -d
docker compose down
```

Expected: Docker build and startup succeed, then containers are stopped. Stop Docker Desktop after debugging.

- [ ] **Step 7: Commit and push final documentation**

Run: `git diff --check`

Expected: no output.

Run:

```bash
git add scripts/validate-production-env.mjs docs/linux-deployment.md docs/new-project-handoff-2026-07-16.md tests/unit/linux-deployment-package.test.ts tests/unit/security.test.ts
git commit -m "docs: update recruitment deployment guidance"
git push
```

Expected: commit and push succeed.

---

## Completion Gate

- `npm.cmd test` passes.
- `npm.cmd build` passes.
- All implemented phases have their own commit and have been pushed.
- No secrets, `.env`, browser sessions, database files, logs, or root handoff file are staged.
- Docker is stopped if it was used.

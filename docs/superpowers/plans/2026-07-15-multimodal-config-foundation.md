# Multimodal Configuration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing database-backed AI configuration system so speech, digital-human, and behavior providers can store encrypted provider credentials and editable per-model settings without hard-coded model names.

**Architecture:** Keep `AiServiceProvider` as the authentication/endpoint owner and `AiModelConfig` as the capability-routing unit. Add encrypted JSON credentials, public provider settings, and model settings while retaining the current API key columns for backward compatibility. Introduce media-provider contracts and a database resolver that every later plan will use.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Zod, Prisma 5 with SQLite, React 19, Vitest.

---

## File Map

- Modify `prisma/schema.prisma`: add provider credential/settings and model settings columns.
- Create `prisma/migrations/20260715090000_add_multimodal_config/migration.sql`: additive migration only.
- Modify `lib/domain/aiServices.ts`: encrypted JSON helpers and safe preview generation.
- Modify `lib/validators/aiServices.ts`: strict schemas for credentials and settings.
- Modify `app/api/ai-services/providers/route.ts`: save encrypted provider credentials without returning plaintext.
- Modify `app/api/ai-services/models/route.ts`: save model `settingsJson`.
- Modify `app/api/ai-services/models/[modelId]/route.ts`: edit full model configuration, not only flags.
- Create `lib/media/types.ts`: stable contracts for ASR, TTS, digital-human, and behavior adapters.
- Create `lib/media/config.ts`: resolve the current enabled default model from the database.
- Create `lib/media/errors.ts`: typed provider and configuration errors.
- Modify `components/admin/AiServiceConfigPanel.tsx`: provider-specific fields and editable model settings.
- Modify `lib/domain/modelRecommendations.ts`: Alibaba defaults are seed suggestions only.
- Modify `lib/db/seed.ts`: optional Alibaba model defaults when an Alibaba provider exists.
- Test `tests/unit/multimodal-config.test.ts`.
- Test `tests/unit/ai-service-routes.test.ts`.

### Task 1: Add additive configuration columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260715090000_add_multimodal_config/migration.sql`
- Test: `tests/unit/multimodal-config.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("multimodal provider configuration schema", () => {
  it("stores encrypted provider credentials and editable settings", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("credentialsCiphertext String?");
    expect(schema).toContain("credentialsIv         String?");
    expect(schema).toContain("credentialsTag        String?");
    expect(schema).toContain("credentialsPreviewJson String?");
    expect(schema).toContain('settingsJson          String           @default("{}")');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/unit/multimodal-config.test.ts`

Expected: FAIL because the new columns are absent.

- [ ] **Step 3: Add the Prisma fields**

Add to `AiServiceProvider`:

```prisma
  credentialsCiphertext  String?
  credentialsIv          String?
  credentialsTag         String?
  credentialsPreviewJson String?
  settingsJson           String             @default("{}")
```

Add to `AiModelConfig`:

```prisma
  settingsJson String @default("{}")
```

Create the migration:

```sql
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsCiphertext" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsIv" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsTag" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsPreviewJson" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "AiModelConfig" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}';
```

- [ ] **Step 4: Generate Prisma Client and run the test**

Run: `npm run db:generate`

Expected: Prisma Client generation succeeds.

Run: `npm test -- tests/unit/multimodal-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260715090000_add_multimodal_config/migration.sql tests/unit/multimodal-config.test.ts
git commit -m "add multimodal provider configuration fields"
```

### Task 2: Encrypt structured credentials

**Files:**
- Modify: `lib/domain/aiServices.ts`
- Modify: `lib/validators/aiServices.ts`
- Test: `tests/unit/multimodal-config.test.ts`

- [ ] **Step 1: Add failing encryption and validation tests**

```ts
import {
  decryptCredentialMap,
  encryptCredentialMap,
  previewCredentialMap
} from "@/lib/domain/aiServices";
import { parseAiServiceProviderInput } from "@/lib/validators/aiServices";

it("round-trips structured credentials without exposing values in previews", () => {
  const credentials = { apiKey: "sk-secret", asrApiKey: "sk-asr", rtcAppKey: "rtc-secret" };
  const encrypted = encryptCredentialMap(credentials, "config-secret");
  expect(decryptCredentialMap(encrypted, "config-secret")).toEqual(credentials);
  expect(JSON.stringify(previewCredentialMap(credentials))).not.toContain("sk-secret");
});

it("accepts strict public settings and credential maps", () => {
  expect(parseAiServiceProviderInput({
    displayName: "Alibaba Model Studio",
    providerType: "TONGYI",
    baseUrl: "https://dashscope.aliyuncs.com",
    enabled: true,
    credentials: { apiKey: "sk-test", rtcAppKey: "rtc-test" },
    settings: { region: "cn-beijing", workspaceId: "ws-1", rtcAppId: "rtc-app" }
  }).settings.region).toBe("cn-beijing");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/unit/multimodal-config.test.ts`

Expected: FAIL with missing helper exports and rejected fields.

- [ ] **Step 3: Implement credential helpers**

Add to `lib/domain/aiServices.ts`:

```ts
export type CredentialMap = Record<string, string>;

export function encryptCredentialMap(credentials: CredentialMap, configSecret: string) {
  return encryptSecret(JSON.stringify(credentials), configSecret);
}

export function decryptCredentialMap(encrypted: EncryptedSecret, configSecret: string): CredentialMap {
  const parsed = JSON.parse(decryptSecret(encrypted, configSecret)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored provider credentials are invalid.");
  }
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function previewCredentialMap(credentials: CredentialMap) {
  return Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, maskSecret(value)]));
}
```

Extend the provider schema in `lib/validators/aiServices.ts`:

```ts
const stringMap = z.record(z.string().trim().min(1).max(500)).default({});

credentials: stringMap,
settings: z.record(z.union([z.string(), z.number(), z.boolean()])).default({})
```

Extend the model schema:

```ts
settings: z.record(z.union([z.string(), z.number(), z.boolean()])).default({})
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/multimodal-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/aiServices.ts lib/validators/aiServices.ts tests/unit/multimodal-config.test.ts
git commit -m "encrypt structured provider credentials"
```

### Task 3: Persist and edit provider/model settings

**Files:**
- Modify: `app/api/ai-services/providers/route.ts`
- Modify: `app/api/ai-services/models/route.ts`
- Modify: `app/api/ai-services/models/[modelId]/route.ts`
- Test: `tests/unit/ai-service-routes.test.ts`

- [ ] **Step 1: Add failing route assertions**

Add tests that post Alibaba credentials/settings and assert Prisma receives encrypted fields plus JSON settings, then patch a model name and settings:

```ts
expect(prisma.aiServiceProvider.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    credentialsCiphertext: expect.any(String),
    credentialsPreviewJson: expect.stringContaining("****"),
    settingsJson: JSON.stringify({ region: "cn-beijing", workspaceId: "ws-1" })
  })
});

expect(prisma.aiModelConfig.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    modelName: "qwen3.6-flash-2026-04-16",
    settingsJson: JSON.stringify({ sampleRate: 24000 })
  })
}));
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `npm test -- tests/unit/ai-service-routes.test.ts`

Expected: FAIL because routes ignore the new fields and PATCH rejects model edits.

- [ ] **Step 3: Update provider serialization and persistence**

Persist `credentials` using `encryptCredentialMap`; serialize only `credentialsPreview`, parsed `settings`, and existing safe fields. Merge new credentials with existing decrypted credentials on update so leaving a secret input blank does not erase it.

Use this response shape:

```ts
{
  id,
  displayName,
  providerType,
  baseUrl,
  apiKeyPreview,
  credentialsPreview: JSON.parse(credentialsPreviewJson || "{}"),
  settings: JSON.parse(settingsJson || "{}"),
  enabled,
  notes,
  createdAt,
  updatedAt
}
```

- [ ] **Step 4: Update model create and patch routes**

Store `settingsJson: JSON.stringify(input.settings)`. Expand `updateModelSchema` to accept:

```ts
const updateModelSchema = aiModelConfigInputSchema
  .omit({ providerId: true })
  .partial()
  .strict();
```

When capability changes or `isDefault` becomes true, clear defaults for the target capability inside the existing transaction.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/ai-service-routes.test.ts tests/unit/multimodal-config.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/ai-services/providers/route.ts app/api/ai-services/models/route.ts app/api/ai-services/models/[modelId]/route.ts tests/unit/ai-service-routes.test.ts
git commit -m "support editable multimodal provider settings"
```

### Task 4: Add media contracts and dynamic resolver

**Files:**
- Create: `lib/media/types.ts`
- Create: `lib/media/config.ts`
- Create: `lib/media/errors.ts`
- Test: `tests/unit/media-config.test.ts`

- [ ] **Step 1: Write resolver tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveMediaModel } from "@/lib/media/config";

it("uses the database default model name instead of a hard-coded value", async () => {
  const findModel = vi.fn().mockResolvedValue({
    id: "model-1",
    modelName: "qwen3.6-flash-2026-04-16",
    capability: "VISION_BEHAVIOR_ANALYSIS",
    settingsJson: '{"minimumConfidence":0.6}',
    provider: { id: "provider-1", providerType: "TONGYI", settingsJson: "{}", enabled: true }
  });
  const result = await resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel);
  expect(result.modelName).toBe("qwen3.6-flash-2026-04-16");
  expect(result.modelSettings.minimumConfidence).toBe(0.6);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/media-config.test.ts`

Expected: FAIL because the media modules do not exist.

- [ ] **Step 3: Create stable contracts**

Define `CapabilityCheckResult`, `SpeechToTextProvider`, `TextToSpeechProvider`, `RealtimeDigitalHumanProvider`, `BehaviorAnalysisProvider`, and their input/result types in `lib/media/types.ts`. Every result includes `provider`, `model`, `mode`, `traceId`, and `fallbackUsed` where applicable.

Create errors:

```ts
export class MediaConfigurationError extends Error {}
export class MediaProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly code?: string,
    readonly retryable = false
  ) {
    super(message);
  }
}
```

Implement `resolveMediaModel` by calling `findDefaultAiModel(capability)`, parsing provider/model settings JSON, and throwing `MediaConfigurationError` when no enabled default exists.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/media-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media/types.ts lib/media/config.ts lib/media/errors.ts tests/unit/media-config.test.ts
git commit -m "add dynamic media provider contracts"
```

### Task 5: Make Alibaba defaults editable in the admin UI

**Files:**
- Modify: `components/admin/AiServiceConfigPanel.tsx`
- Modify: `lib/domain/modelRecommendations.ts`
- Modify: `lib/db/seed.ts`
- Test: `tests/unit/ai-services.test.ts`
- Test: `tests/unit/model-recommendations.test.ts`

- [ ] **Step 1: Update tests for current defaults**

Assert the recommendation matrix contains:

```ts
expect(recommendations).toEqual(expect.arrayContaining([
  expect.objectContaining({ capability: "SPEECH_TO_TEXT", modelName: "qwen3-asr-flash-realtime" }),
  expect.objectContaining({ capability: "TEXT_TO_SPEECH", modelName: "qwen3-tts-instruct-flash-realtime" }),
  expect.objectContaining({ capability: "DIGITAL_HUMAN_REALTIME", modelName: "avatar-dialog" }),
  expect.objectContaining({ capability: "VISION_BEHAVIOR_ANALYSIS", modelName: "qwen3.6-flash" })
]));
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/unit/model-recommendations.test.ts tests/unit/ai-services.test.ts`

Expected: FAIL on outdated recommendation names.

- [ ] **Step 3: Update recommendations and UI fields**

For `TONGYI`, render public settings fields for `region`, `workspaceId`, and `rtcAppId`, and secret inputs for `apiKey`, `asrApiKey`, and `rtcAppKey`. For model settings render capability-specific controls; keep `modelName` editable and never disable it after applying a recommendation.

Use these seed defaults only when an Alibaba provider record already exists; do not create a provider with empty credentials:

```ts
const alibabaDefaults = [
  ["SPEECH_TO_TEXT", "qwen3-asr-flash-realtime"],
  ["TEXT_TO_SPEECH", "qwen3-tts-instruct-flash-realtime"],
  ["DIGITAL_HUMAN_REALTIME", "avatar-dialog"],
  ["VISION_BEHAVIOR_ANALYSIS", "qwen3.6-flash"]
] as const;
```

- [ ] **Step 4: Run focused tests and build**

Run: `npm test -- tests/unit/model-recommendations.test.ts tests/unit/ai-services.test.ts tests/unit/ai-service-routes.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AiServiceConfigPanel.tsx lib/domain/modelRecommendations.ts lib/db/seed.ts tests/unit/model-recommendations.test.ts tests/unit/ai-services.test.ts
git commit -m "add editable Alibaba media defaults"
```

### Task 6: Foundation regression verification

**Files:**
- Modify: `docs/digital-human-and-behavior-interfaces.md`

- [ ] **Step 1: Document the provider/model ownership rule**

Document that provider settings own region/workspace/RTC credentials, model settings own voice/sample rate/avatar/confidence, and all four Alibaba model names are editable defaults.

- [ ] **Step 2: Run migration on a copied development database**

Run: `npm run db:migrate:deploy`

Expected: migration applies without dropping existing candidates, sessions, models, or reports.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add docs/digital-human-and-behavior-interfaces.md
git commit -m "document multimodal configuration ownership"
```

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schemaPath = join(root, "prisma/schema.prisma");
const migrationPath = join(
  root,
  "prisma/migrations/20260729130000_add_alibaba_video_digital_human/migration.sql"
);

describe("Alibaba dual video persistence schema", () => {
  it("persists the required video runtime models and retires DUIX without deleting history", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const migration = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8")
      : "";
    const requiredModels = [
      "MediaStorageConfig",
      "InterviewerAvatarProfile",
      "DigitalHumanMediaAsset",
      "DigitalHumanRenderJob",
      "DigitalHumanRenderAttempt"
    ];

    for (const model of requiredModels) {
      expect(schema).toContain(`model ${model}`);
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DigitalHumanRenderAttempt_renderJobId_providerKind_key"'
    );
    expect(migration).toContain(
      `UPDATE "AiServiceProvider" SET "enabled" = 0 WHERE "providerType" = 'DUIX'`
    );
    expect(migration).toContain(
      `UPDATE "AiModelConfig" SET "enabled" = 0, "isDefault" = 0, "isSelected" = 0`
    );
  });
});

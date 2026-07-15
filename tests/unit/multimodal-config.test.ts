import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = join(
  root,
  "prisma/migrations/20260715090000_add_multimodal_config/migration.sql"
);

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function modelFields(schema: string, modelName: string) {
  const model = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));

  expect(model, `Expected ${modelName} model in Prisma schema`).not.toBeNull();

  return model![1]
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function migrationSql() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

describe("multimodal configuration columns", () => {
  it("declares additive provider credentials and settings fields in the Prisma schema", () => {
    const schema = readWorkspaceFile("prisma/schema.prisma");

    expect(modelFields(schema, "AiServiceProvider")).toEqual(
      expect.arrayContaining([
        "credentialsCiphertext String?",
        "credentialsIv String?",
        "credentialsTag String?",
        "credentialsPreviewJson String?",
        'settingsJson String @default("{}")'
      ])
    );
    expect(modelFields(schema, "AiModelConfig")).toContain(
      'settingsJson String @default("{}")'
    );
  });

  it("contains only the required additive ALTER TABLE statements", () => {
    const statements = migrationSql()
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    expect(statements).toEqual([
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsCiphertext" TEXT',
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsIv" TEXT',
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsTag" TEXT',
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsPreviewJson" TEXT',
      `ALTER TABLE "AiServiceProvider" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE "AiModelConfig" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}'`
    ]);
  });

  it("does not use destructive DROP statements", () => {
    expect(migrationSql()).not.toMatch(/\bDROP\b/i);
  });
});

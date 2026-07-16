import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const prismaDirectory = join(root, "prisma");
const prismaCliPath = join(root, "node_modules/prisma/build/index.js");
const initMigrationPath = join(
  prismaDirectory,
  "migrations/20260707120000_init/migration.sql"
);
const multimodalMigrationPath = join(
  prismaDirectory,
  "migrations/20260715090000_add_multimodal_config/migration.sql"
);
const uniqueDefaultsMigrationPath = join(
  prismaDirectory,
  "migrations/20260715093000_unique_ai_model_defaults/migration.sql"
);

const duplicateDefaultsSql = `
PRAGMA foreign_keys = ON;

INSERT INTO "AiServiceProvider" (
  "id", "displayName", "providerType", "createdAt", "updatedAt"
) VALUES (
  'provider-1', 'Provider', 'OPENAI_COMPATIBLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "AiModelConfig" (
  "id", "providerId", "displayName", "modelName", "capability",
  "enabled", "isDefault", "createdAt", "updatedAt"
) VALUES
  ('report-a', 'provider-1', 'Report A', 'report-a', 'REPORT_ANALYSIS', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('report-b', 'provider-1', 'Report B', 'report-b', 'REPORT_ANALYSIS', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('report-c', 'provider-1', 'Report C', 'report-c', 'REPORT_ANALYSIS', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('follow-up-a', 'provider-1', 'Follow-up A', 'follow-up-a', 'INTERVIEW_FOLLOW_UP', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`;

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    { cwd: prismaDirectory, stdio: "pipe" }
  );
}

async function withMigratedDatabase(
  verify: (prisma: PrismaClient) => Promise<void>
) {
  const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".default-constraint-"));
  const seedPath = join(temporaryDirectory, "seed.sql");
  const databaseUrl = `file:./${basename(temporaryDirectory)}/constraint.db`;
  let prisma: PrismaClient | undefined;

  try {
    writeFileSync(seedPath, duplicateDefaultsSql, "utf8");
    executeSqlFile(initMigrationPath, databaseUrl);
    executeSqlFile(multimodalMigrationPath, databaseUrl);
    executeSqlFile(seedPath, databaseUrl);
    executeSqlFile(uniqueDefaultsMigrationPath, databaseUrl);
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await verify(prisma);
  } finally {
    try {
      await prisma?.$disconnect();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

describe("AI model default uniqueness migration", () => {
  it("exists and creates a partial unique capability index", () => {
    expect(existsSync(uniqueDefaultsMigrationPath)).toBe(true);

    const sql = existsSync(uniqueDefaultsMigrationPath)
      ? readFileSync(uniqueDefaultsMigrationPath, "utf8")
      : "";

    expect(sql).toMatch(/CREATE UNIQUE INDEX/i);
    expect(sql).toMatch(/ON\s+"AiModelConfig"\s*\(\s*"capability"\s*\)/i);
    expect(sql).toMatch(/WHERE\s+"isDefault"\s*=\s*1/i);
  });

  it("deduplicates defaults and rejects conflicting inserts and updates", async () => {
    expect(existsSync(uniqueDefaultsMigrationPath)).toBe(true);
    if (!existsSync(uniqueDefaultsMigrationPath)) {
      return;
    }

    await withMigratedDatabase(async (prisma) => {
      const defaults = await prisma.aiModelConfig.findMany({
        where: { isDefault: true },
        orderBy: [{ capability: "asc" }, { id: "asc" }],
        select: { id: true, capability: true }
      });

      expect(defaults).toEqual([
        { id: "follow-up-a", capability: "INTERVIEW_FOLLOW_UP" },
        { id: "report-a", capability: "REPORT_ANALYSIS" }
      ]);

      await expect(prisma.aiModelConfig.create({
        data: {
          id: "report-d",
          providerId: "provider-1",
          displayName: "Report D",
          modelName: "report-d",
          capability: "REPORT_ANALYSIS",
          enabled: true,
          isDefault: true
        }
      })).rejects.toMatchObject({ code: "P2002" });

      await expect(prisma.aiModelConfig.update({
        where: { id: "report-c" },
        data: { isDefault: true }
      })).rejects.toMatchObject({ code: "P2002" });

      await expect(prisma.aiModelConfig.create({
        data: {
          id: "vision-a",
          providerId: "provider-1",
          displayName: "Vision A",
          modelName: "vision-a",
          capability: "VISION_BEHAVIOR_ANALYSIS",
          enabled: true,
          isDefault: true
        }
      })).resolves.toMatchObject({
        id: "vision-a",
        capability: "VISION_BEHAVIOR_ANALYSIS",
        isDefault: true
      });
    });
  });
});

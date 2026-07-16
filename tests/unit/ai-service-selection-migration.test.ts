import { execFileSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const prismaDirectory = join(root, "prisma");
const prismaCliPath = join(root, "node_modules/prisma/build/index.js");
const initMigrationPath = join(prismaDirectory, "migrations/20260707120000_init/migration.sql");
const multimodalMigrationPath = join(
  prismaDirectory,
  "migrations/20260715090000_add_multimodal_config/migration.sql"
);
const defaultMigrationPath = join(
  prismaDirectory,
  "migrations/20260715093000_unique_ai_model_defaults/migration.sql"
);
const migrationPath = join(
  root,
  "prisma/migrations/20260715094000_add_ai_model_selection/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    { cwd: prismaDirectory, stdio: "pipe" }
  );
}

describe("AI model selection migration", () => {
  it("adds an independent selected state and preserves the existing runtime choice", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

    expect(sql).toMatch(/ADD COLUMN\s+"isSelected"/i);
    expect(sql).toMatch(/SET\s+"isSelected"\s*=\s*"isDefault"/i);
    expect(sql).toMatch(/DROP INDEX IF EXISTS\s+"AiModelConfig_one_default_per_capability"/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*"capability"[\s\S]*WHERE\s+"isSelected"\s*=\s*1/i);
  });

  it("executes against SQLite and lets recommendation differ from runtime selection", async () => {
    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".selection-migration-"));
    const seedPath = join(temporaryDirectory, "seed.sql");
    const databaseUrl = `file:./${basename(temporaryDirectory)}/selection.db`;
    let prisma: PrismaClient | undefined;

    try {
      writeFileSync(seedPath, `
        INSERT INTO "AiServiceProvider" (
          "id", "displayName", "providerType", "enabled", "createdAt", "updatedAt"
        ) VALUES
          ('provider-1', 'Provider', 'OPENAI_COMPATIBLE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('provider-disabled', 'Disabled Provider', 'OPENAI_COMPATIBLE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        INSERT INTO "AiModelConfig" (
          "id", "providerId", "displayName", "modelName", "capability",
          "enabled", "isDefault", "createdAt", "updatedAt"
        ) VALUES
          ('recommended', 'provider-1', 'Recommended', 'recommended', 'REPORT_ANALYSIS', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('runtime', 'provider-1', 'Runtime', 'runtime', 'REPORT_ANALYSIS', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('disabled-provider-model', 'provider-disabled', 'Disabled Provider Model', 'disabled-provider-model', 'TEXT_TO_SPEECH', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `, "utf8");

      executeSqlFile(initMigrationPath, databaseUrl);
      executeSqlFile(multimodalMigrationPath, databaseUrl);
      executeSqlFile(seedPath, databaseUrl);
      executeSqlFile(defaultMigrationPath, databaseUrl);
      executeSqlFile(migrationPath, databaseUrl);

      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      await expect(prisma.aiModelConfig.findFirst({
        where: { isSelected: true },
        select: { id: true }
      })).resolves.toEqual({ id: "recommended" });

      await expect(prisma.aiModelConfig.findUnique({
        where: { id: "disabled-provider-model" },
        select: { isDefault: true, isSelected: true }
      })).resolves.toEqual({ isDefault: true, isSelected: false });

      await expect(prisma.aiModelConfig.update({
        where: { id: "runtime" },
        data: { isSelected: true }
      })).rejects.toMatchObject({ code: "P2002" });

      await prisma.$transaction([
        prisma.aiModelConfig.updateMany({
          where: { capability: "REPORT_ANALYSIS" },
          data: { isSelected: false }
        }),
        prisma.aiModelConfig.update({
          where: { id: "runtime" },
          data: { isSelected: true }
        })
      ]);

      await expect(prisma.aiModelConfig.findMany({
        where: { capability: "REPORT_ANALYSIS" },
        orderBy: { id: "asc" },
        select: { id: true, isDefault: true, isSelected: true }
      })).resolves.toEqual([
        { id: "recommended", isDefault: true, isSelected: false },
        { id: "runtime", isDefault: false, isSelected: true }
      ]);
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  });
});

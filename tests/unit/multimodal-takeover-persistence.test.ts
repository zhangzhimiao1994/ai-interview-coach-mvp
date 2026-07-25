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
const migrationPath = join(
  prismaDirectory,
  "migrations/20260725200000_add_ai_runtime_settings/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    {
      cwd: prismaDirectory,
      stdio: "pipe"
    }
  );
}

describe("multimodal takeover persistence", () => {
  it("adds a generic AI runtime settings table for the Omni takeover switch", async () => {
    const schema = readFileSync(join(prismaDirectory, "schema.prisma"), "utf8");
    expect(schema).toContain("model AiRuntimeSetting");
    expect(schema).toContain("key       String   @id");
    expect(schema).toContain("valueJson String   @default(\"{}\")");

    expect(existsSync(migrationPath)).toBe(true);
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
    expect(sql).toContain("CREATE TABLE \"AiRuntimeSetting\"");
    expect(sql).toContain("\"key\" TEXT NOT NULL PRIMARY KEY");
    expect(sql).toContain("\"valueJson\" TEXT NOT NULL DEFAULT '{}'");

    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".multimodal-takeover-"));
    const databaseUrl = `file:./${basename(temporaryDirectory)}/migration.db`;
    let prisma: PrismaClient | undefined;

    try {
      executeSqlFile(migrationPath, databaseUrl);
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AiRuntimeSetting" ("key", "valueJson", "createdAt", "updatedAt")
        VALUES (
          'ai.multimodalTakeover',
          '{"enabled":true,"modelId":"model-omni","coveredCapabilities":["INTERVIEW_FOLLOW_UP"]}',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `);

      const rows = await prisma.$queryRawUnsafe<Array<{
        key: string;
        valueJson: string;
      }>>(`SELECT "key", "valueJson" FROM "AiRuntimeSetting"`);

      expect(rows).toEqual([
        {
          key: "ai.multimodalTakeover",
          valueJson:
            '{"enabled":true,"modelId":"model-omni","coveredCapabilities":["INTERVIEW_FOLLOW_UP"]}'
        }
      ]);
    } finally {
      await prisma?.$disconnect();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

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
const lifecycleMigrationPath = join(
  prismaDirectory,
  "migrations/20260717110000_add_digital_human_sessions/migration.sql"
);
const recoveryMigrationPath = join(
  prismaDirectory,
  "migrations/20260718090000_add_provider_session_close_recovery/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    { cwd: prismaDirectory, stdio: "pipe" }
  );
}

describe("provider session close recovery migration", () => {
  it("declares a generic durable recovery queue without credentials, RTC, or audio", () => {
    const schema = readFileSync(join(prismaDirectory, "schema.prisma"), "utf8");
    const model =
      schema.match(/model ProviderSessionCloseRecovery \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(model).toContain("providerSessionId");
    expect(model).toContain("providerConfigVersion");
    expect(model).toContain("nextAttemptAt");
    expect(model).toContain("lastErrorCode");
    expect(model).not.toMatch(/\b(token|accessKey|rtcParams|audio|secret|credential)\b/i);
  });

  it("applies after the published lifecycle migration and guards close-critical provider changes", async () => {
    expect(existsSync(recoveryMigrationPath)).toBe(true);
    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".close-recovery-"));
    const setupPath = join(temporaryDirectory, "setup.sql");
    const databaseUrl = `file:./${basename(temporaryDirectory)}/migration.db`;
    let prisma: PrismaClient | undefined;

    try {
      writeFileSync(
        setupPath,
        `
          PRAGMA foreign_keys = ON;
          CREATE TABLE "TrainingSession" ("id" TEXT NOT NULL PRIMARY KEY);
          CREATE TABLE "AiServiceProvider" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "displayName" TEXT NOT NULL,
            "providerType" TEXT NOT NULL,
            "settingsJson" TEXT NOT NULL DEFAULT '{}',
            "credentialsCiphertext" TEXT,
            "credentialsIv" TEXT,
            "credentialsTag" TEXT
          );
          INSERT INTO "AiServiceProvider" (
            "id", "displayName", "providerType", "settingsJson"
          ) VALUES (
            'provider-1', 'Lingmou', 'LINGMOU', '{"region":"cn-beijing"}'
          );
        `,
        "utf8"
      );
      executeSqlFile(setupPath, databaseUrl);
      executeSqlFile(lifecycleMigrationPath, databaseUrl);
      executeSqlFile(recoveryMigrationPath, databaseUrl);
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });

      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("ProviderSessionCloseRecovery")`
      );
      expect(columns.map((column) => column.name)).toEqual([
        "id",
        "providerId",
        "providerSessionId",
        "instanceId",
        "providerConfigVersion",
        "reasonCode",
        "attemptCount",
        "nextAttemptAt",
        "lastErrorCode",
        "createdAt",
        "updatedAt"
      ]);
      expect(columns.map((column) => column.name).join(" ")).not.toMatch(
        /token|accessKey|rtcParams|audio|secret|credential/i
      );

      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderSessionCloseRecovery" (
          "id", "providerId", "providerSessionId", "instanceId",
          "providerConfigVersion", "reasonCode", "nextAttemptAt", "updatedAt"
        ) VALUES (
          'recovery-1', 'provider-1', 'upstream-1', 'instance-1', 0,
          'CREATE_COMPENSATION_FAILED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "AiServiceProvider"
          SET "settingsJson" = '{"region":"us-west"}'
          WHERE "id" = 'provider-1'
        `)
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM "AiServiceProvider" WHERE "id" = 'provider-1'`
        )
      ).rejects.toThrow();

      await prisma.$executeRawUnsafe(
        `DELETE FROM "ProviderSessionCloseRecovery" WHERE "id" = 'recovery-1'`
      );
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "AiServiceProvider"
          SET "settingsJson" = '{"region":"us-west"}'
          WHERE "id" = 'provider-1'
        `)
      ).resolves.toBe(1);
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  });
});

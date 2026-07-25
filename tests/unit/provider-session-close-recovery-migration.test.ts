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
const originalRecoveryMigrationPath = join(
  prismaDirectory,
  "migrations/20260718090000_add_provider_session_close_recovery/migration.sql"
);
const recoveryUpgradeMigrationPath = join(
  prismaDirectory,
  "migrations/20260718120000_upgrade_provider_session_close_recovery/migration.sql"
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
    expect(model).toContain("claimExpiresAt");
    expect(model).toContain("nextAttemptAt");
    expect(model).toContain("lastErrorCode");
    expect(model).not.toMatch(/\b(token|accessKey|rtcParams|audio|secret|credential)\b/i);
  });

  it("upgrades a populated legacy queue forward without checksum drift or data loss", async () => {
    expect(existsSync(originalRecoveryMigrationPath)).toBe(true);
    expect(existsSync(recoveryUpgradeMigrationPath)).toBe(true);
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
          INSERT INTO "TrainingSession" ("id") VALUES ('training-1');
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
      executeSqlFile(originalRecoveryMigrationPath, databaseUrl);
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });

      const legacyColumns = await prisma.$queryRawUnsafe<
        Array<{ name: string; notnull: bigint }>
      >(`PRAGMA table_info("ProviderSessionCloseRecovery")`);
      expect(legacyColumns.map((column) => column.name)).toEqual([
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
      expect(
        legacyColumns.find((column) => column.name === "providerSessionId")?.notnull
      ).toBe(1n);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderSessionCloseRecovery" (
          "id", "providerId", "providerSessionId", "instanceId",
          "providerConfigVersion", "reasonCode", "attemptCount",
          "nextAttemptAt", "lastErrorCode", "createdAt", "updatedAt"
        ) VALUES (
          'legacy-recovery', 'provider-1', 'legacy-upstream', 'instance-1',
          0, 'CREATE_COMPENSATION_FAILED', 2,
          '2026-07-18T04:00:00.000Z', 'SAFE_OLD_ERROR',
          '2026-07-18T03:00:00.000Z', '2026-07-18T03:30:00.000Z'
        )
      `);

      await prisma.$disconnect();
      prisma = undefined;
      executeSqlFile(recoveryUpgradeMigrationPath, databaseUrl);
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });

      const columns = await prisma.$queryRawUnsafe<
        Array<{ name: string; notnull: bigint }>
      >(`PRAGMA table_info("ProviderSessionCloseRecovery")`);
      expect(columns.map((column) => column.name)).toEqual([
        "id",
        "providerId",
        "digitalHumanSessionId",
        "providerSessionId",
        "instanceId",
        "providerConfigVersion",
        "reasonCode",
        "attemptCount",
        "nextAttemptAt",
        "claimExpiresAt",
        "lastErrorCode",
        "createdAt",
        "updatedAt"
      ]);
      expect(
        columns.find((column) => column.name === "providerSessionId")?.notnull
      ).toBe(0n);
      expect(columns.map((column) => column.name).join(" ")).not.toMatch(
        /token|accessKey|rtcParams|audio|secret|credential/i
      );

      const legacyRow = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT * FROM "ProviderSessionCloseRecovery"
        WHERE "id" = 'legacy-recovery'
      `);
      expect(legacyRow).toEqual([
        expect.objectContaining({
          id: "legacy-recovery",
          providerId: "provider-1",
          digitalHumanSessionId: null,
          providerSessionId: "legacy-upstream",
          instanceId: "instance-1",
          providerConfigVersion: 0,
          reasonCode: "CREATE_COMPENSATION_FAILED",
          attemptCount: 2,
          claimExpiresAt: null,
          lastErrorCode: "SAFE_OLD_ERROR"
        })
      ]);

      const foreignKeys = await prisma.$queryRawUnsafe<
        Array<{ table: string; from: string; to: string; on_delete: string }>
      >(`PRAGMA foreign_key_list("ProviderSessionCloseRecovery")`);
      expect(foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "DigitalHumanSession",
            from: "digitalHumanSessionId",
            to: "id",
            on_delete: "SET NULL"
          }),
          expect.objectContaining({
            table: "AiServiceProvider",
            from: "providerId",
            to: "id",
            on_delete: "RESTRICT"
          })
        ])
      );
      const indexes = await prisma.$queryRawUnsafe<
        Array<{ name: string; unique: bigint }>
      >(`PRAGMA index_list("ProviderSessionCloseRecovery")`);
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "ProviderSessionCloseRecovery_digitalHumanSessionId_key",
            unique: 1n
          })
        ])
      );

      await prisma.$executeRawUnsafe(`
        INSERT INTO "DigitalHumanSession" (
          "id", "trainingSessionId", "adapter", "mode", "status",
          "expiresAt", "updatedAt"
        ) VALUES (
          'digital-1', 'training-1', 'LOCAL',
          'LOCAL_AVATAR', 'STOPPED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderSessionCloseRecovery" (
          "id", "providerId", "digitalHumanSessionId", "providerSessionId",
          "instanceId", "providerConfigVersion", "reasonCode",
          "nextAttemptAt", "updatedAt"
        ) VALUES (
          'linked-1', 'provider-1', 'digital-1', 'upstream-linked-1',
          'instance-1', 0, 'CREATE_COMPENSATION_FAILED',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "ProviderSessionCloseRecovery" (
            "id", "providerId", "digitalHumanSessionId", "providerSessionId",
            "instanceId", "providerConfigVersion", "reasonCode",
            "nextAttemptAt", "updatedAt"
          ) VALUES (
            'linked-2', 'provider-1', 'digital-1', 'upstream-linked-2',
            'instance-1', 0, 'CREATE_COMPENSATION_FAILED',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `)
      ).rejects.toThrow();

      await prisma.$executeRawUnsafe(
        `DELETE FROM "ProviderSessionCloseRecovery"`
      );
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "AiServiceProvider"
          SET "settingsJson" = '{"region":"us-west"}'
          WHERE "id" = 'provider-1'
        `)
      ).resolves.toBe(1);
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "ProviderSessionCloseRecovery" (
            "id", "providerId", "digitalHumanSessionId", "providerSessionId",
            "instanceId", "providerConfigVersion", "reasonCode",
            "nextAttemptAt", "claimExpiresAt", "updatedAt"
          ) VALUES (
            'stale-claim', 'provider-1', NULL, NULL, 'instance-1', 0,
            'DIAGNOSTIC_LIVE_OPERATION', CURRENT_TIMESTAMP,
            '2026-07-18T04:05:00.000Z', CURRENT_TIMESTAMP
          )
        `)
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "ProviderSessionCloseRecovery" (
            "id", "providerId", "digitalHumanSessionId", "providerSessionId",
            "instanceId", "providerConfigVersion", "reasonCode",
            "nextAttemptAt", "claimExpiresAt", "updatedAt"
          ) VALUES (
            'current-claim', 'provider-1', NULL, NULL, 'instance-1', 1,
            'DIAGNOSTIC_LIVE_OPERATION', CURRENT_TIMESTAMP,
            '2026-07-18T04:05:00.000Z', CURRENT_TIMESTAMP
          )
        `)
      ).resolves.toBe(1);
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        rmSync(temporaryDirectory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100
        });
      }
    }
  }, 60_000);
});

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
  "migrations/20260717110000_add_digital_human_sessions/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    { cwd: prismaDirectory, stdio: "pipe" }
  );
}

describe("digital human session migration", () => {
  it("declares only the non-secret lifecycle model and relation", () => {
    const schema = readFileSync(join(prismaDirectory, "schema.prisma"), "utf8");
    const model = schema.match(/model DigitalHumanSession \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(model).toContain("trainingSession   TrainingSession @relation");
    expect(model).toContain("providerSessionId String?");
    expect(model).toContain("lastActivityAt    DateTime");
    expect(model).not.toMatch(/\b(token|accessKey|rtcParams|audio|nonce|gslb)\b/i);
  });

  it("creates the foreign key and lifecycle indexes without secret or audio columns", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".digital-human-session-"));
    const setupPath = join(temporaryDirectory, "setup.sql");
    const databaseUrl = `file:./${basename(temporaryDirectory)}/migration.db`;
    let prisma: PrismaClient | undefined;

    try {
      writeFileSync(
        setupPath,
        `
          PRAGMA foreign_keys = ON;
          CREATE TABLE "TrainingSession" (
            "id" TEXT NOT NULL PRIMARY KEY
          );
          INSERT INTO "TrainingSession" ("id") VALUES ('training-1');
          INSERT INTO "TrainingSession" ("id") VALUES ('training-2');
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
      executeSqlFile(migrationPath, databaseUrl);
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });

      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("DigitalHumanSession")`
      );
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA index_list("DigitalHumanSession")`
      );
      const foreignKeys = await prisma.$queryRawUnsafe<
        Array<{ table: string; from: string; to: string; on_delete: string }>
      >(`PRAGMA foreign_key_list("DigitalHumanSession")`);

      expect(columns.map((column) => column.name)).toEqual([
        "id",
        "trainingSessionId",
        "providerId",
        "modelId",
        "adapter",
        "mode",
        "providerSessionId",
        "instanceId",
        "providerConfigVersion",
        "status",
        "lastActivityAt",
        "expiresAt",
        "endedAt",
        "stopReason",
        "createdAt",
        "updatedAt"
      ]);
      expect(columns.map((column) => column.name).join(" ")).not.toMatch(
        /token|accessKey|rtcParams|audio|nonce|gslb/i
      );
      expect(indexes.map((index) => index.name).sort()).toEqual([
        "DigitalHumanSession_one_active_per_training_session",
        "DigitalHumanSession_providerSessionId_idx",
        "DigitalHumanSession_status_lastActivityAt_idx",
        "DigitalHumanSession_trainingSessionId_idx",
        "sqlite_autoindex_DigitalHumanSession_1"
      ]);
      expect(foreignKeys).toEqual([
        expect.objectContaining({
          table: "TrainingSession",
          from: "trainingSessionId",
          to: "id",
          on_delete: "CASCADE"
        })
      ]);

      const triggers = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`
      );
      expect(triggers.map((trigger) => trigger.name)).toEqual([
        "DigitalHumanSession_close_config_claim_guard",
        "DigitalHumanSession_provider_close_config_delete_guard",
        "DigitalHumanSession_provider_close_config_update_guard",
        "DigitalHumanSession_provider_close_config_version"
      ]);

      await prisma.$executeRawUnsafe(`
        INSERT INTO "DigitalHumanSession" (
          "id", "trainingSessionId", "providerId", "adapter", "mode",
          "instanceId", "providerConfigVersion", "status", "expiresAt", "updatedAt"
        ) VALUES (
          'active-1', 'training-1', 'provider-1', 'LINGMOU_OFFICIAL_SDK',
          'LINGMOU_CLOUD', 'instance-1', 0, 'READY', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `);
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "AiServiceProvider" SET "displayName" = 'Safe rename'
          WHERE "id" = 'provider-1'
        `)
      ).resolves.toBe(1);
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "AiServiceProvider"
          SET "settingsJson" = '{"region":"us-west"}'
          WHERE "id" = 'provider-1'
        `)
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          DELETE FROM "AiServiceProvider" WHERE "id" = 'provider-1'
        `)
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "DigitalHumanSession" (
            "id", "trainingSessionId", "adapter", "mode", "status",
            "expiresAt", "updatedAt"
          ) VALUES (
            'active-2', 'training-1', 'LOCAL', 'LOCAL_AVATAR', 'CONNECTING',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `)
      ).rejects.toThrow();
      await prisma.$executeRawUnsafe(`
        UPDATE "DigitalHumanSession" SET "status" = 'STOPPED'
        WHERE "id" = 'active-1'
      `);
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "AiServiceProvider"
          SET "settingsJson" = '{"region":"us-west"}'
          WHERE "id" = 'provider-1'
        `)
      ).resolves.toBe(1);
      const providerVersion = await prisma.$queryRawUnsafe<
        Array<{ closeConfigVersion: number }>
      >(`SELECT "closeConfigVersion" FROM "AiServiceProvider" WHERE "id" = 'provider-1'`);
      expect(providerVersion).toEqual([{ closeConfigVersion: 1 }]);

      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "DigitalHumanSession" (
            "id", "trainingSessionId", "providerId", "adapter", "mode",
            "instanceId", "providerConfigVersion", "status", "expiresAt", "updatedAt"
          ) VALUES (
            'active-2', 'training-2', 'provider-1', 'LINGMOU_OFFICIAL_SDK',
            'LINGMOU_CLOUD', 'instance-2', 0, 'FAILED', CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `)
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "DigitalHumanSession" (
            "id", "trainingSessionId", "providerId", "adapter", "mode",
            "instanceId", "providerConfigVersion", "status", "expiresAt", "updatedAt"
          ) VALUES (
            'active-2', 'training-2', 'provider-1', 'LINGMOU_OFFICIAL_SDK',
            'LINGMOU_CLOUD', 'instance-2', 1, 'FAILED', CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `)
      ).resolves.toBe(1);

      await prisma.$executeRawUnsafe(`
        UPDATE "DigitalHumanSession" SET "status" = 'STOPPED'
        WHERE "id" = 'active-2'
      `);
      await expect(
        prisma.$executeRawUnsafe(`
          DELETE FROM "AiServiceProvider" WHERE "id" = 'provider-1'
        `)
      ).resolves.toBe(1);

      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "DigitalHumanSession" (
            "id", "trainingSessionId", "adapter", "mode", "expiresAt", "updatedAt"
          ) VALUES (
            'invalid-session', 'missing-training', 'LOCAL', 'LOCAL_AVATAR',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `)
      ).rejects.toThrow();
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  });
});

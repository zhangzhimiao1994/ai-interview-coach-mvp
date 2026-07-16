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
  "migrations/20260716195500_use_http_alibaba_tts_model/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    { cwd: prismaDirectory, stdio: "pipe" }
  );
}

describe("Alibaba HTTP TTS seed migration", () => {
  it("updates only untouched seeded realtime references", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8")
      : "";
    expect(sql).toContain("qwen3-tts-instruct-flash");
    expect(sql).toContain("alibaba-media-%-text-to-speech");

    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".tts-model-"));
    const setupPath = join(temporaryDirectory, "setup.sql");
    const databaseUrl = `file:./${basename(temporaryDirectory)}/migration.db`;
    let prisma: PrismaClient | undefined;

    try {
      writeFileSync(setupPath, `
        CREATE TABLE "AiModelConfig" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "displayName" TEXT NOT NULL,
          "modelName" TEXT NOT NULL,
          "settingsJson" TEXT NOT NULL DEFAULT '{}',
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO "AiModelConfig" ("id", "displayName", "modelName", "settingsJson") VALUES
          ('alibaba-media-provider-1-text-to-speech', '阿里百炼 实时语音合成', 'qwen3-tts-instruct-flash-realtime', '{"voice":"Cherry","sampleRate":24000,"format":"pcm"}'),
          ('user-custom-model', '用户自定义', 'qwen3-tts-instruct-flash-realtime', '{"voice":"Cherry"}'),
          ('alibaba-media-provider-2-text-to-speech', '已升级', 'qwen3-tts-instruct-flash', '{"voice":"Cherry"}');
      `, "utf8");
      executeSqlFile(setupPath, databaseUrl);
      executeSqlFile(migrationPath, databaseUrl);

      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string;
        displayName: string;
        modelName: string;
        settingsJson: string;
      }>>(`
        SELECT id, displayName, modelName, settingsJson
        FROM AiModelConfig
        ORDER BY id
      `);

      expect(rows).toEqual([
        {
          id: "alibaba-media-provider-1-text-to-speech",
          displayName: "阿里百炼 非实时语音合成",
          modelName: "qwen3-tts-instruct-flash",
          settingsJson: JSON.stringify({
            voice: "Cherry",
            instructions: "语气专业、自然、清晰。"
          })
        },
        {
          id: "alibaba-media-provider-2-text-to-speech",
          displayName: "已升级",
          modelName: "qwen3-tts-instruct-flash",
          settingsJson: JSON.stringify({ voice: "Cherry" })
        },
        {
          id: "user-custom-model",
          displayName: "用户自定义",
          modelName: "qwen3-tts-instruct-flash-realtime",
          settingsJson: JSON.stringify({ voice: "Cherry" })
        }
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

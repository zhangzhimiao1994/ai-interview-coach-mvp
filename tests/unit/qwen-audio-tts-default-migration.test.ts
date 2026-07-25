import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const prismaDirectory = join(root, "prisma");
const prismaCliPath = join(root, "node_modules/prisma/build/index.js");
const migrationPath = join(
  prismaDirectory,
  "migrations/20260725193000_use_qwen_audio_tts_default/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(process.execPath, [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl], {
    cwd: prismaDirectory,
    stdio: "pipe"
  });
}

describe("Qwen-Audio-TTS default migration", () => {
  it("upgrades only untouched CosyVoice seed rows", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
    expect(sql).toContain("qwen-audio-3.0-tts-flash");
    expect(sql).toContain("longanhuan_v3.6");

    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".qwen-audio-tts-"));
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
          ('alibaba-media-provider-1-text-to-speech', '阿里百炼 CosyVoice 语音合成', 'cosyvoice-v3-flash', '{"voice":"longanhuan","format":"pcm","sampleRate":48000,"channels":1,"instruction":"你说话的情感是 neutral."}'),
          ('alibaba-media-provider-2-text-to-speech', '阿里百炼 CosyVoice 语音合成', 'cosyvoice-v3-flash', '{"voice":"custom","format":"pcm","sampleRate":48000,"channels":1,"instruction":"你说话的情感是 neutral."}'),
          ('user-custom-model', '用户自定义', 'cosyvoice-v3-flash', '{"voice":"longanhuan","format":"pcm","sampleRate":48000,"channels":1,"instruction":"你说话的情感是 neutral."}');
      `, "utf8");
      executeSqlFile(setupPath, databaseUrl);
      executeSqlFile(migrationPath, databaseUrl);

      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string;
        displayName: string;
        modelName: string;
        settingsJson: string;
      }>>("SELECT id, displayName, modelName, settingsJson FROM AiModelConfig ORDER BY id");

      expect(rows).toEqual([
        {
          id: "alibaba-media-provider-1-text-to-speech",
          displayName: "阿里百炼 Qwen-Audio-TTS 情绪语音合成",
          modelName: "qwen-audio-3.0-tts-flash",
          settingsJson: JSON.stringify({
            voice: "longanhuan_v3.6",
            format: "pcm",
            sampleRate: 48000,
            channels: 1,
            instruction: "像专业面试官一样自然、清晰地表达；可根据文本中的 [whisper]、[laughs]、[angry] 等标签添加情绪。"
          })
        },
        {
          id: "alibaba-media-provider-2-text-to-speech",
          displayName: "阿里百炼 CosyVoice 语音合成",
          modelName: "cosyvoice-v3-flash",
          settingsJson: JSON.stringify({
            voice: "custom",
            format: "pcm",
            sampleRate: 48000,
            channels: 1,
            instruction: "你说话的情感是 neutral."
          })
        },
        {
          id: "user-custom-model",
          displayName: "用户自定义",
          modelName: "cosyvoice-v3-flash",
          settingsJson: JSON.stringify({
            voice: "longanhuan",
            format: "pcm",
            sampleRate: 48000,
            channels: 1,
            instruction: "你说话的情感是 neutral."
          })
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

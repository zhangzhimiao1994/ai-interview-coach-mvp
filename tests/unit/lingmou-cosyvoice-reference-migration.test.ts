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
  "migrations/20260717090000_use_cosyvoice_lingmou_references/migration.sql"
);

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(process.execPath, [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl], {
    cwd: prismaDirectory,
    stdio: "pipe"
  });
}

describe("CosyVoice and Lingmou reference migration", () => {
  it("updates only untouched seeded references", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
    expect(sql).toContain("cosyvoice-v3-flash");
    expect(sql).toContain("avatar-dialog");

    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".lingmou-cosyvoice-"));
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
          "enabled" BOOLEAN NOT NULL DEFAULT 1,
          "isDefault" BOOLEAN NOT NULL DEFAULT 0,
          "isSelected" BOOLEAN NOT NULL DEFAULT 0
        );
        INSERT INTO "AiModelConfig" ("id", "displayName", "modelName", "settingsJson", "enabled", "isDefault", "isSelected") VALUES
          ('alibaba-media-provider-1-text-to-speech', '阿里百炼 非实时语音合成', 'qwen3-tts-instruct-flash', '{"voice":"Cherry","instructions":"语气专业、自然、清晰。"}', 1, 1, 0),
          ('alibaba-media-provider-1-digital-human-realtime', '阿里云 Avatar 实时数字人', 'avatar-dialog', '{"avatarId":"","voiceId":"","rtcMode":"web"}', 1, 1, 1),
          ('user-custom-model', '用户自定义', 'qwen3-tts-instruct-flash', '{"voice":"Cherry","instructions":"语气专业、自然、清晰。"}', 1, 1, 0),
          ('alibaba-media-provider-2-text-to-speech', '阿里百炼 非实时语音合成', 'qwen3-tts-instruct-flash', '{"voice":"Custom","instructions":"语气专业、自然、清晰。"}', 1, 1, 0),
          ('alibaba-media-provider-2-digital-human-realtime', '已编辑数字人', 'avatar-dialog', '{"avatarId":"custom","voiceId":"","rtcMode":"web"}', 1, 1, 1);
      `, "utf8");
      executeSqlFile(setupPath, databaseUrl);
      executeSqlFile(migrationPath, databaseUrl);

      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string; displayName: string; modelName: string; settingsJson: string;
        enabled: boolean; isDefault: boolean; isSelected: boolean;
      }>>("SELECT id, displayName, modelName, settingsJson, enabled, isDefault, isSelected FROM AiModelConfig ORDER BY id");

      expect(rows).toEqual([
        {
          id: "alibaba-media-provider-1-digital-human-realtime", displayName: "阿里云 Avatar 实时数字人",
          modelName: "avatar-dialog", settingsJson: JSON.stringify({ avatarId: "", voiceId: "", rtcMode: "web" }),
          enabled: false, isDefault: false, isSelected: false
        },
        {
          id: "alibaba-media-provider-1-text-to-speech", displayName: "阿里百炼 CosyVoice 语音合成",
          modelName: "cosyvoice-v3-flash", settingsJson: JSON.stringify({ voice: "longanhuan", format: "pcm", sampleRate: 48000, channels: 1, instruction: "你说话的情感是 neutral." }),
          enabled: true, isDefault: true, isSelected: false
        },
        {
          id: "alibaba-media-provider-2-digital-human-realtime", displayName: "已编辑数字人",
          modelName: "avatar-dialog", settingsJson: JSON.stringify({ avatarId: "custom", voiceId: "", rtcMode: "web" }),
          enabled: true, isDefault: true, isSelected: true
        },
        {
          id: "alibaba-media-provider-2-text-to-speech", displayName: "阿里百炼 非实时语音合成",
          modelName: "qwen3-tts-instruct-flash", settingsJson: JSON.stringify({ voice: "Custom", instructions: "语气专业、自然、清晰。" }),
          enabled: true, isDefault: true, isSelected: false
        },
        {
          id: "user-custom-model", displayName: "用户自定义", modelName: "qwen3-tts-instruct-flash",
          settingsJson: JSON.stringify({ voice: "Cherry", instructions: "语气专业、自然、清晰。" }),
          enabled: true, isDefault: true, isSelected: false
        }
      ]);
    } finally {
      try { await prisma?.$disconnect(); } finally { rmSync(temporaryDirectory, { recursive: true, force: true }); }
    }
  });
});

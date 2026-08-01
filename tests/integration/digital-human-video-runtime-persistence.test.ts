import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveDigitalHumanVideoRuntime, saveDigitalHumanVideoStorage } from "@/app/api/ai-services/digital-human-video-runtime/handler";
import { createAdminSessionCookie, adminSessionCookieName } from "@/lib/security/adminSession";
import { createCandidateSessionCookie, candidateSessionCookieName } from "@/lib/security/candidateSession";
import { authorizeAdminRequest, requestHasTrustedOrigin } from "@/lib/security/adminRouteAuth";

const secret = "task-nine-strong-secret-1234567890-ABCD";
let directory = ""; let client: PrismaClient;

beforeAll(async () => {
  const prismaDir = join(process.cwd(), "prisma"); directory = mkdtempSync(join(prismaDir, ".task9-runtime-"));
  const url = `file:./${basename(directory)}/runtime.db`; const sqlFile = join(directory, "setup.sql");
  writeFileSync(sqlFile, readdirSync(join(prismaDir, "migrations")).filter((name) => /^\d/.test(name)).sort().map((name) => readFileSync(join(prismaDir, "migrations", name, "migration.sql"), "utf8")).join("\n"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "execute", "--file", sqlFile, "--url", url], { cwd: prismaDir, stdio: "pipe" });
  client = new PrismaClient({ datasourceUrl: url });
  const admin = await client.adminUser.create({ data: { id: "admin-1", username: "root", passwordHash: "not-used", role: "SUPER_ADMIN", enabled: true } });
  expect(admin.id).toBe("admin-1");
}, 30_000);

afterAll(async () => { await client?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

describe("default administrator authorization", () => {
  it("accepts only a strong signed cookie for an enabled administrator row", async () => {
    const cookie = await createAdminSessionCookie({ subject: "admin-1", username: "root", source: "database" }, secret);
    const request = new Request("http://localhost/api/admin/interviewer-profiles", { headers: { cookie: `${adminSessionCookieName}=${encodeURIComponent(cookie)}` } });
    await expect(authorizeAdminRequest(request, client, () => secret)).resolves.toEqual({ id: "admin-1", role: "SUPER_ADMIN" });
    await client.adminUser.update({ where: { id: "admin-1" }, data: { enabled: false } });
    await expect(authorizeAdminRequest(request, client, () => secret)).resolves.toBeNull();
    await client.adminUser.update({ where: { id: "admin-1" }, data: { enabled: true } });
    await expect(authorizeAdminRequest(request, client, () => "development-ai-config-secret-change-me")).resolves.toBeNull();
  });

  it("denies candidate capability cookies and forged origins", async () => {
    const candidate = await createCandidateSessionCookie({ trainingSessionId: "session-1", candidateId: "candidate-1" }, secret);
    const request = new Request("http://localhost/api/admin/interviewer-profiles", { headers: { cookie: `${candidateSessionCookieName}=${candidate}` } });
    await expect(authorizeAdminRequest(request, client, () => secret)).resolves.toBeNull();
    expect(requestHasTrustedOrigin(new Request("http://localhost/api/admin/interviewer-profiles", { headers: { origin: "https://attacker.example" } }))).toBe(false);
    expect(requestHasTrustedOrigin(new Request("http://localhost/api/admin/interviewer-profiles", { headers: { origin: "http://localhost" } }))).toBe(true);
  });
});

describe("transactional video runtime persistence", () => {
  it("retains the exact encrypted envelope on omitted-secret updates and rolls back invalid runtime", async () => {
    await seedCompatibleRuntime(client);
    await saveDigitalHumanVideoStorage({ displayName: "Private OSS", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "private-bucket", region: "cn-hangzhou", enabled: true, credentials: { accessKeyId: "LTAI-real", accessKeySecret: "top-secret" } }, client, secret);
    const storage = await client.mediaStorageConfig.findFirstOrThrow({ where: { enabled: true } });
    const envelope = { ciphertext: storage.credentialsCiphertext, iv: storage.credentialsIv, tag: storage.credentialsTag };
    await saveDigitalHumanVideoStorage({ id: storage.id, displayName: "Renamed OSS", endpoint: storage.endpoint, bucket: storage.bucket, region: null, enabled: true }, client, secret);
    const retained = await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: storage.id } });
    expect({ ciphertext: retained.credentialsCiphertext, iv: retained.credentialsIv, tag: retained.credentialsTag }).toEqual(envelope);
    expect(retained.region).toBeNull();

    const valid = runtime("ling-model", "emo-model", "profile-1");
    await saveDigitalHumanVideoRuntime({ runtime: valid, storage: null }, client);
    const before = await client.aiRuntimeSetting.findUniqueOrThrow({ where: { key: "digital-human-video-runtime" } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: { ...valid, lingmouModelId: "missing" }, storage: null }, client)).rejects.toThrow("MODEL_PROVIDER_MISMATCH");
    expect((await client.aiRuntimeSetting.findUniqueOrThrow({ where: { key: "digital-human-video-runtime" } })).valueJson).toBe(before.valueJson);
    expect((await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: storage.id } })).credentialsCiphertext).toBe(envelope.ciphertext);
  });

  it("rejects runtime activation when no enabled ALI_OSS exists", async () => {
    const storage = await client.mediaStorageConfig.findFirstOrThrow({ where: { enabled: true } }); await client.mediaStorageConfig.update({ where: { id: storage.id }, data: { enabled: false } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: runtime("ling-model", "emo-model", "profile-1"), storage: null }, client)).rejects.toThrow("OSS_STORAGE_REQUIRED");
    await client.mediaStorageConfig.update({ where: { id: storage.id }, data: { enabled: true } });
  });
});

async function seedCompatibleRuntime(db: PrismaClient) {
  const ling = await db.aiServiceProvider.create({ data: { id: "ling-provider", displayName: "Lingmou", providerType: "LINGMOU", enabled: true } });
  const emo = await db.aiServiceProvider.create({ data: { id: "emo-provider", displayName: "Bailian", providerType: "TONGYI", enabled: true } });
  await db.aiModelConfig.create({ data: { id: "ling-model", providerId: ling.id, displayName: "Lingmou custom", modelName: "custom-broadcast", capability: "DIGITAL_HUMAN_VIDEO", settingsJson: JSON.stringify({ templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait", watermark: false, fps: 25 }), enabled: true } });
  await db.aiModelConfig.create({ data: { id: "emo-model", providerId: emo.id, displayName: "EMO", modelName: "emo-v1", capability: "DIGITAL_HUMAN_VIDEO", settingsJson: JSON.stringify({ model: "emo-v1", ratio: "1:1" }), enabled: true } });
  const placeholderStorage = await db.mediaStorageConfig.create({ data: { id: "seed-storage", displayName: "seed", providerKind: "ALI_OSS", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "seed-bucket", enabled: false } });
  const portrait = await db.digitalHumanMediaAsset.create({ data: { id: "portrait-1", storageConfigId: placeholderStorage.id, objectKey: "media/portrait/test.png", mimeType: "image/png", byteLength: 100, purpose: "PORTRAIT", expiresAt: null } });
  await db.interviewerAvatarProfile.create({ data: { id: "profile-1", displayName: "Lin", voice: "patient_voice", styleJson: JSON.stringify({ defaultInstruction: "patient", speed: 0.9 }), portraitAssetId: portrait.id, lingmouMappingJson: JSON.stringify({ templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait" }), emoMappingJson: JSON.stringify({ portraitWidth: 800, portraitHeight: 1000 }), providerRole: "PRIMARY", enabled: true } });
}
function runtime(lingmouModelId: string, emoModelId: string, primaryProfileId: string) { return { mode: "AUTO_RACE" as const, maxWaitMs: 8000 as const, lingmouPollMs: [3000, 6000] as [3000, 6000], emoPollMs: [8000] as [8000], synchronizeProfiles: true, primaryProfileId, secondaryProfileId: null, lingmouModelId, emoModelId }; }

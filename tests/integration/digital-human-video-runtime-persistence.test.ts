import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveDigitalHumanVideoRuntime, saveDigitalHumanVideoStorage } from "@/app/api/ai-services/digital-human-video-runtime/handler";
import { saveInterviewerProfile } from "@/app/api/admin/interviewer-profiles/handler";
import { encryptCredentialMap, encryptSecret } from "@/lib/domain/aiServices";
import { createAdminSessionCookie, adminSessionCookieName } from "@/lib/security/adminSession";
import { createCandidateSessionCookie, candidateSessionCookieName } from "@/lib/security/candidateSession";
import { authorizeAdminRequest, requestHasTrustedOrigin } from "@/lib/security/adminRouteAuth";

const secret = "runtime-persistence-test-secret-1234567890-ABCD";
let directory = ""; let client: PrismaClient;
let databaseUrl = "";
let previousConfigSecret: string | undefined;

beforeAll(async () => {
  previousConfigSecret = process.env.AI_CONFIG_SECRET;
  process.env.AI_CONFIG_SECRET = secret;
  const prismaDir = join(process.cwd(), "prisma"); directory = mkdtempSync(join(prismaDir, ".task9-runtime-"));
  const url = `file:./${basename(directory)}/runtime.db`; databaseUrl = url; const sqlFile = join(directory, "setup.sql");
  writeFileSync(sqlFile, readdirSync(join(prismaDir, "migrations")).filter((name) => /^\d/.test(name)).sort().map((name) => readFileSync(join(prismaDir, "migrations", name, "migration.sql"), "utf8")).join("\n"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "execute", "--file", sqlFile, "--url", url], { cwd: prismaDir, stdio: "pipe" });
  client = new PrismaClient({ datasourceUrl: url });
  const admin = await client.adminUser.create({ data: { id: "admin-1", username: "root", passwordHash: "not-used", role: "SUPER_ADMIN", enabled: true } });
  expect(admin.id).toBe("admin-1");
  await seedCompatibleRuntime(client);
}, 30_000);

afterAll(async () => { await client?.$disconnect(); rmSync(directory, { recursive: true, force: true }); if (previousConfigSecret === undefined) delete process.env.AI_CONFIG_SECRET; else process.env.AI_CONFIG_SECRET = previousConfigSecret; });

beforeEach(async () => {
  await client.aiRuntimeSetting.deleteMany({ where: { key: "digital-human-video-runtime" } });
  await client.mediaStorageConfig.deleteMany({ where: { id: { not: "seed-storage" } } });
  const credentials = encryptCredentialMap({ accessKeyId: "LTAI-seed", accessKeySecret: "seed-secret" }, secret);
  await client.mediaStorageConfig.update({ where: { id: "seed-storage" }, data: { enabled: true, credentialsCiphertext: credentials.ciphertext, credentialsIv: credentials.iv, credentialsTag: credentials.tag } });
  await client.interviewerAvatarProfile.update({ where: { id: "profile-1" }, data: { displayName: "Lin", lingmouMappingJson: JSON.stringify({ templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait" }), emoMappingJson: JSON.stringify({ portraitWidth: 800, portraitHeight: 1000 }) } });
});

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
  it("migrates immutable portrait dimensions on media assets", async () => {
    const columns = await client.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info('DigitalHumanMediaAsset')");
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining(["portraitWidth", "portraitHeight"]));
    expect(await client.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("rejects a provider-shaped custom model that the production adapter cannot use", async () => {
    await expect(saveDigitalHumanVideoRuntime({ runtime: runtime("custom-ling-model", "emo-model", "profile-1"), storage: null }, client)).rejects.toThrow("MODEL_PROVIDER_MISMATCH");
    await expect(saveDigitalHumanVideoRuntime({ runtime: runtime("ling-model", "emo-model", "profile-1"), storage: null }, client)).resolves.toMatchObject({ runtime: { lingmouModelId: "ling-model" } });
  });

  it("rejects profile mappings that do not match the selected adapter and portrait", async () => {
    await client.interviewerAvatarProfile.update({ where: { id: "profile-1" }, data: { lingmouMappingJson: JSON.stringify({ templateId: "wrong-template", audioVariableName: "audio", portraitVariableName: "portrait" }) } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: runtime("ling-model", "emo-model", "profile-1"), storage: null }, client)).rejects.toThrow("PROFILE_INCOMPLETE");
    await client.interviewerAvatarProfile.update({ where: { id: "profile-1" }, data: { lingmouMappingJson: JSON.stringify({ templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait" }) } });
    await client.interviewerAvatarProfile.update({ where: { id: "profile-1" }, data: { emoMappingJson: JSON.stringify({ portraitWidth: 801, portraitHeight: 1000 }) } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: runtime("ling-model", "emo-model", "profile-1"), storage: null }, client)).rejects.toThrow("PROFILE_INCOMPLETE");
    await client.interviewerAvatarProfile.update({ where: { id: "profile-1" }, data: { emoMappingJson: JSON.stringify({ portraitWidth: 800, portraitHeight: 1000 }) } });
  });

  it("saves profiles transactionally only when EMO dimensions match immutable portrait metadata", async () => {
    const input = { action: "SAVE_PROFILE" as const, id: "profile-1", displayName: "Changed", voice: "patient_voice", style: { defaultInstruction: "patient", speed: 0.9 }, portraitAssetId: "portrait-1", lingmouMapping: { templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait" }, emoMapping: { portraitWidth: 801, portraitHeight: 1000 }, providerRole: "PRIMARY", enabled: true };
    await expect(saveInterviewerProfile(input, client)).rejects.toThrow("PORTRAIT_DIMENSIONS_MISMATCH");
    expect((await client.interviewerAvatarProfile.findUniqueOrThrow({ where: { id: "profile-1" } })).displayName).toBe("Lin");
    await expect(saveInterviewerProfile({ ...input, emoMapping: { portraitWidth: 800, portraitHeight: 1000 } }, client)).resolves.toMatchObject({ displayName: "Changed" });
  });

  it("rejects a stale storage id and an incomplete retained credential envelope in the runtime branch", async () => {
    const valid = runtime("ling-model", "emo-model", "profile-1");
    await expect(saveDigitalHumanVideoRuntime({ runtime: valid, storage: { id: "missing-storage", displayName: "Missing", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "missing-bucket", region: "cn-hangzhou", enabled: true, credentials: { accessKeyId: "LTAI-new", accessKeySecret: "new-secret" } } }, client)).rejects.toThrow("OSS_STORAGE_NOT_FOUND");
    const storage = await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: "seed-storage" } });
    await client.mediaStorageConfig.update({ where: { id: storage.id }, data: { enabled: true, credentialsCiphertext: "incomplete", credentialsIv: null, credentialsTag: null } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: valid, storage: { id: storage.id, displayName: storage.displayName, endpoint: storage.endpoint, bucket: storage.bucket, region: storage.region, enabled: true } }, client)).rejects.toThrow("OSS_CREDENTIALS_REQUIRED");
    await client.mediaStorageConfig.update({ where: { id: storage.id }, data: { enabled: false, credentialsCiphertext: null, credentialsIv: null, credentialsTag: null } });
  });

  it("retains the exact encrypted envelope on omitted-secret updates and rolls back invalid runtime", async () => {
    await saveDigitalHumanVideoStorage({ id: "seed-storage", displayName: "Private OSS", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "private-bucket", region: "cn-hangzhou", enabled: true, credentials: { accessKeyId: "LTAI-real", accessKeySecret: "top-secret" } }, client, secret);
    const storage = await client.mediaStorageConfig.findFirstOrThrow({ where: { displayName: "Private OSS", enabled: true } });
    const envelope = { ciphertext: storage.credentialsCiphertext, iv: storage.credentialsIv, tag: storage.credentialsTag };
    await saveDigitalHumanVideoStorage({ id: storage.id, displayName: "Renamed OSS", endpoint: storage.endpoint, bucket: storage.bucket, region: null, enabled: true }, client, secret);
    const retained = await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: storage.id } });
    const replacement = await client.mediaStorageConfig.findFirstOrThrow({ where: { providerKind: "ALI_OSS", enabled: true } });
    expect({ ciphertext: retained.credentialsCiphertext, iv: retained.credentialsIv, tag: retained.credentialsTag }).toEqual(envelope);
    expect(retained).toMatchObject({ region: storage.region, enabled: false });
    expect(replacement.id).not.toBe(storage.id);
    expect(replacement.region).toBeNull();
    expect({ ciphertext: replacement.credentialsCiphertext, iv: replacement.credentialsIv, tag: replacement.credentialsTag }).toEqual(envelope);

    const valid = runtime("ling-model", "emo-model", "profile-1");
    await saveDigitalHumanVideoRuntime({ runtime: valid, storage: null }, client);
    const before = await client.aiRuntimeSetting.findUniqueOrThrow({ where: { key: "digital-human-video-runtime" } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: { ...valid, lingmouModelId: "missing" }, storage: null }, client)).rejects.toThrow("MODEL_PROVIDER_MISMATCH");
    expect((await client.aiRuntimeSetting.findUniqueOrThrow({ where: { key: "digital-human-video-runtime" } })).valueJson).toBe(before.valueJson);
    expect((await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: storage.id } })).credentialsCiphertext).toBe(envelope.ciphertext);
  });

  it("versions immutable storage identity instead of mutating assets onto new credentials", async () => {
    const old = await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: "seed-storage" } });
    await client.digitalHumanMediaAsset.create({ data: { id: "old-audio", storageConfigId: old.id, objectKey: "media/audio/shared.wav", mimeType: "audio/wav", byteLength: 10, purpose: "TTS_AUDIO", expiresAt: new Date("2026-08-01T00:00:00.000Z") } });

    await saveDigitalHumanVideoStorage({ id: old.id, displayName: old.displayName, endpoint: old.endpoint, bucket: "new-bucket", region: old.region, enabled: true, credentials: { accessKeyId: "LTAI-new", accessKeySecret: "new-secret" } }, client, secret);

    const retained = await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: old.id } });
    const active = await client.mediaStorageConfig.findFirstOrThrow({ where: { enabled: true, providerKind: "ALI_OSS" }, orderBy: { createdAt: "desc" } });
    expect(active.id).not.toBe(old.id);
    expect(active.bucket).toBe("new-bucket");
    expect(retained).toMatchObject({ bucket: old.bucket, endpoint: old.endpoint, region: old.region, enabled: false });
    expect((await client.digitalHumanMediaAsset.findUniqueOrThrow({ where: { id: "old-audio" } })).storageConfigId).toBe(old.id);
  });

  it("rejects both stale-client write paths without disabling or replacing the current active storage", async () => {
    const staleClient = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const old = await client.mediaStorageConfig.findUniqueOrThrow({ where: { id: "seed-storage" } });
      await saveDigitalHumanVideoStorage({
        id: old.id,
        displayName: "Current OSS",
        endpoint: old.endpoint,
        bucket: "current-bucket",
        region: old.region,
        enabled: true,
        credentials: { accessKeyId: "LTAI-current", accessKeySecret: "current-secret" }
      }, client, secret);
      const current = await client.mediaStorageConfig.findFirstOrThrow({ where: { providerKind: "ALI_OSS", enabled: true } });

      await expect(saveDigitalHumanVideoStorage({
        id: old.id,
        displayName: "Stale different name",
        endpoint: old.endpoint,
        bucket: "stale-bucket",
        region: old.region,
        enabled: true,
        credentials: { accessKeyId: "LTAI-stale", accessKeySecret: "stale-secret" }
      }, staleClient, secret)).rejects.toThrow("STALE_STORAGE_CONFIG");
      await expect(saveDigitalHumanVideoStorage({
        id: old.id,
        displayName: current.displayName,
        endpoint: old.endpoint,
        bucket: "stale-same-name-bucket",
        region: old.region,
        enabled: true,
        credentials: { accessKeyId: "LTAI-stale", accessKeySecret: "stale-secret" }
      }, staleClient, secret)).rejects.toThrow("STALE_STORAGE_CONFIG");

      expect(await client.mediaStorageConfig.findFirstOrThrow({ where: { providerKind: "ALI_OSS", enabled: true } }))
        .toMatchObject({ id: current.id, displayName: "Current OSS", bucket: "current-bucket" });
      expect(await client.mediaStorageConfig.count({ where: { providerKind: "ALI_OSS", enabled: true } })).toBe(1);
    } finally {
      await staleClient.$disconnect();
    }
  });

  it("enforces one enabled configuration per provider kind in SQLite", async () => {
    const indexes = await client.$queryRawUnsafe<Array<{ name: string; sql: string }>>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'MediaStorageConfig_one_enabled_per_provider_idx'`
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].sql).toContain("WHERE \"enabled\" = 1");

    await expect(client.mediaStorageConfig.create({ data: {
      id: "second-active",
      displayName: "Second active",
      providerKind: "ALI_OSS",
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      bucket: "second-active-bucket",
      enabled: true
    } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects runtime activation when no enabled ALI_OSS exists", async () => {
    await client.mediaStorageConfig.updateMany({ data: { enabled: false } });
    await expect(saveDigitalHumanVideoRuntime({ runtime: runtime("ling-model", "emo-model", "profile-1"), storage: null }, client)).rejects.toThrow("OSS_STORAGE_REQUIRED");
  });
});

async function seedCompatibleRuntime(db: PrismaClient) {
  const lingCredentials = encryptCredentialMap({ accessKeyId: "LTAI-ling", accessKeySecret: "ling-secret" }, secret);
  const emoApiKey = encryptSecret("dashscope-key", secret);
  const ling = await db.aiServiceProvider.create({ data: { id: "ling-provider", displayName: "Lingmou", providerType: "LINGMOU", settingsJson: JSON.stringify({ region: "cn-beijing" }), credentialsCiphertext: lingCredentials.ciphertext, credentialsIv: lingCredentials.iv, credentialsTag: lingCredentials.tag, enabled: true } });
  const emo = await db.aiServiceProvider.create({ data: { id: "emo-provider", displayName: "Bailian", providerType: "TONGYI", apiKeyCiphertext: emoApiKey.ciphertext, apiKeyIv: emoApiKey.iv, apiKeyTag: emoApiKey.tag, enabled: true } });
  const lingSettings = { templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait", resolution: "1080p", mode: "portrait", watermark: false, fps: 25 };
  await db.aiModelConfig.create({ data: { id: "custom-ling-model", providerId: ling.id, displayName: "Lingmou custom", modelName: "custom-broadcast", capability: "DIGITAL_HUMAN_VIDEO", settingsJson: JSON.stringify(lingSettings), enabled: true } });
  await db.aiModelConfig.create({ data: { id: "ling-model", providerId: ling.id, displayName: "Lingmou broadcast", modelName: "lingmou-broadcast-video", capability: "DIGITAL_HUMAN_VIDEO", settingsJson: JSON.stringify(lingSettings), enabled: true } });
  await db.aiModelConfig.create({ data: { id: "emo-model", providerId: emo.id, displayName: "EMO", modelName: "emo-v1", capability: "DIGITAL_HUMAN_VIDEO", timeoutMs: 120000, settingsJson: JSON.stringify({ model: "emo-v1", ratio: "1:1", styleLevel: "normal" }), enabled: true } });
  const storageCredentials = encryptCredentialMap({ accessKeyId: "LTAI-seed", accessKeySecret: "seed-secret" }, secret);
  const placeholderStorage = await db.mediaStorageConfig.create({ data: { id: "seed-storage", displayName: "seed", providerKind: "ALI_OSS", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "seed-bucket", credentialsCiphertext: storageCredentials.ciphertext, credentialsIv: storageCredentials.iv, credentialsTag: storageCredentials.tag, enabled: true } });
  const portrait = await db.digitalHumanMediaAsset.create({ data: { id: "portrait-1", storageConfigId: placeholderStorage.id, objectKey: "media/portrait/test.png", mimeType: "image/png", byteLength: 100, purpose: "PORTRAIT", portraitWidth: 800, portraitHeight: 1000, expiresAt: null } });
  await db.interviewerAvatarProfile.create({ data: { id: "profile-1", displayName: "Lin", voice: "patient_voice", styleJson: JSON.stringify({ defaultInstruction: "patient", speed: 0.9 }), portraitAssetId: portrait.id, lingmouMappingJson: JSON.stringify({ templateId: "tpl", audioVariableName: "audio", portraitVariableName: "portrait" }), emoMappingJson: JSON.stringify({ portraitWidth: 800, portraitHeight: 1000 }), providerRole: "PRIMARY", enabled: true } });
}
function runtime(lingmouModelId: string, emoModelId: string, primaryProfileId: string) { return { mode: "AUTO_RACE" as const, maxWaitMs: 8000 as const, lingmouPollMs: [3000, 6000] as [3000, 6000], emoPollMs: [8000] as [8000], synchronizeProfiles: true, primaryProfileId, secondaryProfileId: null, lingmouModelId, emoModelId }; }

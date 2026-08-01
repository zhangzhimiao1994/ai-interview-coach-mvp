import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupExpiredDigitalHumanMediaAssets,
  startDigitalHumanMediaCleanup
} from "@/lib/media/storage/mediaCleanup";

const observedAt = new Date("2026-08-01T12:00:00.000Z");
const secret = "offline-cleanup-test-secret";
let directory = "";
let client: PrismaClient;

beforeAll(async () => {
  const prismaDir = join(process.cwd(), "prisma");
  directory = mkdtempSync(join(prismaDir, ".media-cleanup-"));
  const databaseUrl = `file:./${basename(directory)}/cleanup.db`;
  const setupPath = join(directory, "setup.sql");
  writeFileSync(setupPath, readdirSync(join(prismaDir, "migrations"))
    .filter((name) => /^\d/.test(name)).sort()
    .map((name) => readFileSync(join(prismaDir, "migrations", name, "migration.sql"), "utf8"))
    .join("\n"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "execute", "--file", setupPath, "--url", databaseUrl], { cwd: prismaDir, stdio: "pipe" });
  client = new PrismaClient({ datasourceUrl: databaseUrl });
}, 30_000);

afterAll(async () => {
  await client?.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await client.digitalHumanMediaAsset.deleteMany();
  await client.mediaStorageConfig.deleteMany();
  await createStorage("storage-old", "old-bucket", true, "ALI_OSS");
});

describe("temporary media cleanup with isolated Prisma SQLite", () => {
  it("migrates durable cleanup claim leases", async () => {
    const columns = await client.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info('DigitalHumanMediaAsset')");
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "cleanupClaimToken",
      "cleanupClaimedAt",
      "cleanupClaimExpiresAt"
    ]));
  });

  it("selects only expired assets, records cleanedAt, and rejects non-OSS storage", async () => {
    await createAsset("expired", "storage-old", "media/audio/expired.wav", new Date(observedAt.getTime() - 1));
    await createAsset("future", "storage-old", "media/video/future.mp4", new Date(observedAt.getTime() + 1));
    await createStorage("storage-wrong", "wrong-bucket", true, "S3");
    await createAsset("wrong-provider", "storage-wrong", "media/audio/wrong.wav", new Date(observedAt.getTime() - 1));
    const removed: string[] = [];

    const result = await runCleanup(observedAt, (bucket, key) => { removed.push(`${bucket}:${key}`); });

    expect(result).toEqual({ cleaned: 1, failed: 1 });
    expect(removed).toEqual(["old-bucket:media/audio/expired.wav"]);
    expect(await assetState("expired")).toMatchObject({ cleanupStatus: "CLEANED", cleanedAt: observedAt, cleanupClaimToken: null, cleanupClaimedAt: null, cleanupClaimExpiresAt: null });
    expect(await assetState("future")).toMatchObject({ cleanupStatus: "ACTIVE", cleanedAt: null });
    expect(await assetState("wrong-provider")).toMatchObject({ cleanupStatus: "ACTIVE", cleanedAt: null });
  });

  it("drains more than one hundred expired rows exactly once across concurrent workers", async () => {
    await client.digitalHumanMediaAsset.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
      id: `asset-${index}`,
      storageConfigId: "storage-old",
      objectKey: `media/audio/${index}.wav`,
      mimeType: "audio/wav",
      byteLength: 10,
      purpose: "TTS_AUDIO",
      expiresAt: new Date(observedAt.getTime() - 1)
    })) });
    const removed: string[] = [];
    const deleteBoundary = (bucket: string, key: string) => { removed.push(`${bucket}:${key}`); };

    const results = await Promise.all([runCleanup(observedAt, deleteBoundary), runCleanup(observedAt, deleteBoundary)]);

    expect(results.reduce((sum, result) => sum + result.cleaned, 0)).toBe(205);
    expect(new Set(removed).size).toBe(205);
    expect(await client.digitalHumanMediaAsset.count({ where: { cleanupStatus: "ACTIVE" } })).toBe(0);
  });

  it("recovers a crashed stale claim and later recovers when immediate reset loses ownership", async () => {
    await createAsset("crashed", "storage-old", "media/audio/crashed.wav", new Date(observedAt.getTime() - 1));
    await setClaim("crashed", "crashed-worker", new Date(observedAt.getTime() - 60_000), new Date(observedAt.getTime() - 1));
    const removed: string[] = [];
    expect(await runCleanup(observedAt, (bucket, key) => { removed.push(`${bucket}:${key}`); })).toEqual({ cleaned: 1, failed: 0 });
    expect(removed).toEqual(["old-bucket:media/audio/crashed.wav"]);

    await createAsset("reset-lost", "storage-old", "media/audio/reset-lost.wav", new Date(observedAt.getTime() - 1));
    const first = await runCleanup(observedAt, async () => {
      await client.$executeRawUnsafe(
        `UPDATE "DigitalHumanMediaAsset" SET "cleanupClaimToken" = ?, "cleanupClaimExpiresAt" = ? WHERE "id" = ?`,
        "foreign-worker",
        observedAt.getTime() - 1,
        "reset-lost"
      );
      throw new Error("offline delete failure after ownership changed");
    });
    expect(first).toEqual({ cleaned: 0, failed: 1 });
    expect(await assetState("reset-lost")).toMatchObject({ cleanupStatus: "CLEANING", cleanupClaimToken: "foreign-worker" });
    expect(await runCleanup(new Date(observedAt.getTime() + 1), () => undefined)).toEqual({ cleaned: 1, failed: 0 });
    expect(await assetState("reset-lost")).toMatchObject({ cleanupStatus: "CLEANED", cleanupClaimToken: null });
  });

  it("deletes an old asset with its immutable old bucket after the active configuration changes", async () => {
    await createAsset("old-owned", "storage-old", "media/video/shared.mp4", new Date(observedAt.getTime() - 1));
    await client.mediaStorageConfig.update({ where: { id: "storage-old" }, data: { enabled: false } });
    await createStorage("storage-new", "new-bucket", true, "ALI_OSS");
    const removed: string[] = [];

    await runCleanup(observedAt, (bucket, key) => { removed.push(`${bucket}:${key}`); });

    expect(removed).toEqual(["old-bucket:media/video/shared.mp4"]);
  });

  it("serializes scheduled runs and stop waits for in-flight work before preventing new runs", async () => {
    await createAsset("blocking", "storage-old", "media/audio/blocking.wav", new Date(observedAt.getTime() - 1));
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let runs = 0;
    const stop = startDigitalHumanMediaCleanup({
      intervalMs: 5,
      stopTimeoutMs: 100,
      runCleanup: async () => {
        runs += 1;
        return runCleanup(observedAt, async () => { started(); await blocked; });
      }
    });
    await began;
    const stopping = stop();
    let settled = false;
    void stopping.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await stopping;
    await createAsset("after-stop", "storage-old", "media/audio/after-stop.wav", new Date(observedAt.getTime() - 1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runs).toBe(1);
    expect(await assetState("after-stop")).toMatchObject({ cleanupStatus: "ACTIVE" });
  });

  it("bounds shutdown when an external delete never settles", async () => {
    const stop = startDigitalHumanMediaCleanup({
      intervalMs: 60_000,
      stopTimeoutMs: 20,
      runCleanup: () => new Promise(() => undefined)
    });
    const startedAt = Date.now();
    await stop();
    expect(Date.now() - startedAt).toBeLessThan(200);
  });
});

async function createStorage(id: string, bucket: string, enabled: boolean, providerKind: string) {
  return client.mediaStorageConfig.create({ data: { id, displayName: id, providerKind, endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket, region: "cn-hangzhou", credentialsCiphertext: "cipher", credentialsIv: "iv", credentialsTag: "tag", enabled } });
}

async function createAsset(id: string, storageConfigId: string, objectKey: string, expiresAt: Date) {
  return client.digitalHumanMediaAsset.create({ data: { id, storageConfigId, objectKey, mimeType: objectKey.endsWith(".mp4") ? "video/mp4" : "audio/wav", byteLength: 10, purpose: objectKey.endsWith(".mp4") ? "VIDEO_OUTPUT" : "TTS_AUDIO", expiresAt } });
}

async function setClaim(id: string, token: string, claimedAt: Date, expiresAt: Date) {
  await client.$executeRawUnsafe(
    `UPDATE "DigitalHumanMediaAsset" SET "cleanupStatus" = 'CLEANING', "cleanupClaimToken" = ?, "cleanupClaimedAt" = ?, "cleanupClaimExpiresAt" = ? WHERE "id" = ?`,
    token,
    claimedAt.getTime(),
    expiresAt.getTime(),
    id
  );
}

async function assetState(id: string) {
  return client.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "DigitalHumanMediaAsset" WHERE "id" = ?`, id).then((rows) => rows[0]);
}

async function runCleanup(now: Date, remove: (bucket: string, key: string) => void | Promise<void>) {
  return cleanupExpiredDigitalHumanMediaAssets({
    now,
    client,
    readConfigSecret: () => secret,
    createStorage: (config) => ({ removeObject: (key) => Promise.resolve(remove(config.bucket, key)) })
  });
}

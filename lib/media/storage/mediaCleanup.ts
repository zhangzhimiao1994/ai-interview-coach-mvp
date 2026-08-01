import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { createOssPrivateMediaStorage } from "./ossStorage";
import type { MediaStorageConfigRecord, PrivateMediaStorage } from "./types";

const cleanupBatchSize = 100;
const defaultCleanupIntervalMs = 15 * 60 * 1000;

type CleanupAsset = {
  id: string;
  objectKey: string;
  storageConfig: MediaStorageConfigRecord;
};

type CleanupClient = {
  digitalHumanMediaAsset: {
    findMany(input: unknown): Promise<CleanupAsset[]>;
    updateMany(input: {
      where: { id: string; cleanupStatus: string };
      data: { cleanupStatus: string; cleanedAt?: Date | null };
    }): Promise<{ count: number }>;
  };
};

export type MediaCleanupDependencies = {
  now: Date;
  client: CleanupClient;
  readConfigSecret: () => string;
  createStorage: (
    config: MediaStorageConfigRecord,
    configSecret: string
  ) => Pick<PrivateMediaStorage, "removeObject">;
};

export async function cleanupExpiredDigitalHumanMediaAssets(
  dependencyOverrides: Partial<MediaCleanupDependencies> = {}
) {
  const now = dependencyOverrides.now ?? new Date();
  const client = dependencyOverrides.client ?? (prisma as unknown as CleanupClient);
  const readConfigSecret = dependencyOverrides.readConfigSecret ?? readAiConfigSecret;
  const createStorage = dependencyOverrides.createStorage ?? createOssPrivateMediaStorage;
  const expired = await client.digitalHumanMediaAsset.findMany({
    where: {
      cleanupStatus: "ACTIVE",
      expiresAt: { not: null, lte: now }
    },
    include: { storageConfig: true },
    orderBy: { expiresAt: "asc" },
    take: cleanupBatchSize
  });
  let cleaned = 0;
  let failed = 0;

  for (const asset of expired) {
    const claim = await client.digitalHumanMediaAsset.updateMany({
      where: { id: asset.id, cleanupStatus: "ACTIVE" },
      data: { cleanupStatus: "CLEANING", cleanedAt: null }
    });
    if (claim.count !== 1) continue;

    try {
      const storage = createStorage(asset.storageConfig, readConfigSecret());
      await storage.removeObject(asset.objectKey);
      const terminal = await client.digitalHumanMediaAsset.updateMany({
        where: { id: asset.id, cleanupStatus: "CLEANING" },
        data: { cleanupStatus: "CLEANED", cleanedAt: now }
      });
      if (terminal.count !== 1) throw new Error("MEDIA_CLEANUP_STATE_CONFLICT");
      cleaned += 1;
    } catch {
      await client.digitalHumanMediaAsset.updateMany({
        where: { id: asset.id, cleanupStatus: "CLEANING" },
        data: { cleanupStatus: "ACTIVE", cleanedAt: null }
      });
      failed += 1;
    }
  }

  return { cleaned, failed };
}

export function startDigitalHumanMediaCleanup(input: {
  intervalMs?: number;
  runCleanup?: () => Promise<{ cleaned: number; failed: number }>;
  warn?: (code: string) => void;
} = {}) {
  const runCleanup = input.runCleanup ?? cleanupExpiredDigitalHumanMediaAssets;
  const warn = input.warn ?? ((code: string) => console.warn(code));
  const run = () => {
    void runCleanup().then((result) => {
      if (result.failed > 0) warn("DIGITAL_HUMAN_MEDIA_CLEANUP_PARTIAL_FAILURE");
    }).catch(() => warn("DIGITAL_HUMAN_MEDIA_CLEANUP_FAILED"));
  };
  run();
  const timer = setInterval(run, input.intervalMs ?? defaultCleanupIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { createOssPrivateMediaStorage } from "./ossStorage";
import type { MediaStorageConfigRecord, PrivateMediaStorage } from "./types";

const cleanupBatchSize = 100;
const cleanupLeaseMs = 5 * 60 * 1000;
const defaultCleanupIntervalMs = 15 * 60 * 1000;
const defaultDeleteTimeoutMs = 10_000;
const defaultRunTimeoutMs = 60_000;
const defaultStopTimeoutMs = 4_000;

export type MediaCleanupDependencies = {
  now: Date;
  client: PrismaClient;
  readConfigSecret: () => string;
  createStorage: (
    config: MediaStorageConfigRecord,
    configSecret: string
  ) => Pick<PrivateMediaStorage, "removeObject">;
  deleteTimeoutMs: number;
  runTimeoutMs: number;
};

export async function cleanupExpiredDigitalHumanMediaAssets(
  dependencyOverrides: Partial<MediaCleanupDependencies> = {}
) {
  const now = dependencyOverrides.now ?? new Date();
  const client = dependencyOverrides.client ?? prisma;
  const readConfigSecret = dependencyOverrides.readConfigSecret ?? readAiConfigSecret;
  const createStorage = dependencyOverrides.createStorage ?? createOssPrivateMediaStorage;
  const deleteTimeoutMs = dependencyOverrides.deleteTimeoutMs ?? defaultDeleteTimeoutMs;
  const runTimeoutMs = dependencyOverrides.runTimeoutMs ?? defaultRunTimeoutMs;
  const deadline = Date.now() + runTimeoutMs;
  let cursor: string | undefined;
  let cleaned = 0;
  let failed = 0;

  await client.digitalHumanMediaAsset.updateMany({
    where: {
      cleanupStatus: "ACTIVE",
      OR: [
        { cleanupClaimToken: { not: null } },
        { cleanupClaimedAt: { not: null } },
        { cleanupClaimExpiresAt: { not: null } }
      ]
    },
    data: {
      cleanupClaimToken: null,
      cleanupClaimedAt: null,
      cleanupClaimExpiresAt: null
    }
  });

  await client.digitalHumanMediaAsset.updateMany({
    where: {
      cleanupStatus: "CLEANING",
      OR: [
        { cleanupClaimExpiresAt: null },
        { cleanupClaimExpiresAt: { lte: now } }
      ]
    },
    data: {
      cleanupStatus: "ACTIVE",
      cleanupClaimToken: null,
      cleanupClaimedAt: null,
      cleanupClaimExpiresAt: null
    }
  });

  while (Date.now() <= deadline) {
    const expired = await client.digitalHumanMediaAsset.findMany({
      where: {
        cleanupStatus: "ACTIVE",
        expiresAt: { not: null, lte: now },
        ...(cursor ? { id: { gt: cursor } } : {})
      },
      include: { storageConfig: true },
      orderBy: { id: "asc" },
      take: cleanupBatchSize
    });
    if (expired.length === 0) break;
    cursor = expired[expired.length - 1].id;

    for (const asset of expired) {
      if (Date.now() > deadline) return { cleaned, failed };
      const claimToken = randomUUID();
      const claim = await client.digitalHumanMediaAsset.updateMany({
        where: {
          id: asset.id,
          cleanupStatus: "ACTIVE",
          expiresAt: { not: null, lte: now }
        },
        data: {
          cleanupStatus: "CLEANING",
          cleanupClaimToken: claimToken,
          cleanupClaimedAt: now,
          cleanupClaimExpiresAt: new Date(now.getTime() + cleanupLeaseMs),
          cleanedAt: null
        }
      });
      if (claim.count !== 1) continue;

      let storage: Pick<PrivateMediaStorage, "removeObject">;
      try {
        if (asset.storageConfig.providerKind !== "ALI_OSS") {
          throw new Error("MEDIA_CLEANUP_STORAGE_KIND_INVALID");
        }
        storage = createStorage(asset.storageConfig, readConfigSecret());
      } catch {
        await resetOwnedClaim(client, asset.id, claimToken);
        failed += 1;
        continue;
      }

      try {
        await bounded(storage.removeObject(asset.objectKey), deleteTimeoutMs);
        const terminal = await client.digitalHumanMediaAsset.updateMany({
          where: { id: asset.id, cleanupStatus: "CLEANING", cleanupClaimToken: claimToken },
          data: {
            cleanupStatus: "CLEANED",
            cleanedAt: now,
            cleanupClaimToken: null,
            cleanupClaimedAt: null,
            cleanupClaimExpiresAt: null
          }
        });
        if (terminal.count !== 1) throw new Error("MEDIA_CLEANUP_STATE_CONFLICT");
        cleaned += 1;
      } catch {
        // Once DELETE has been issued its outcome can be unknown. Keep the lease so
        // only stale-lease recovery can retry this immutable physical generation.
        failed += 1;
      }
    }
  }

  return { cleaned, failed };
}

async function resetOwnedClaim(client: PrismaClient, assetId: string, claimToken: string) {
  await client.digitalHumanMediaAsset.updateMany({
    where: { id: assetId, cleanupStatus: "CLEANING", cleanupClaimToken: claimToken },
    data: {
      cleanupStatus: "ACTIVE",
      cleanupClaimToken: null,
      cleanupClaimedAt: null,
      cleanupClaimExpiresAt: null,
      cleanedAt: null
    }
  }).catch(() => ({ count: 0 }));
}

export function startDigitalHumanMediaCleanup(input: {
  intervalMs?: number;
  stopTimeoutMs?: number;
  runCleanup?: () => Promise<{ cleaned: number; failed: number }>;
  warn?: (code: string) => void;
} = {}) {
  const runCleanup = input.runCleanup ?? cleanupExpiredDigitalHumanMediaAssets;
  const warn = input.warn ?? ((code: string) => console.warn(code));
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const trigger = () => {
    if (stopped || inFlight) return;
    inFlight = runCleanup()
      .then((result) => {
        if (result.failed > 0) warn("DIGITAL_HUMAN_MEDIA_CLEANUP_PARTIAL_FAILURE");
      })
      .catch(() => warn("DIGITAL_HUMAN_MEDIA_CLEANUP_FAILED"))
      .finally(() => { inFlight = null; });
  };

  trigger();
  const timer = setInterval(trigger, input.intervalMs ?? defaultCleanupIntervalMs);
  timer.unref();

  return async () => {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
    }
    if (inFlight) {
      await bounded(inFlight, input.stopTimeoutMs ?? defaultStopTimeoutMs).catch(() => undefined);
    }
  };
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("MEDIA_CLEANUP_TIMEOUT")), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

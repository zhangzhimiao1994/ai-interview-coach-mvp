import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import type { MediaStorageConfigRecord, PrivateMediaStorage } from "@/lib/media/storage/types";

const maxVideoBytes = 100 * 1024 * 1024;
const outputLifetimeMs = 23 * 60 * 60 * 1000;

export async function cacheProviderVideoOutput(input: {
  attemptId: string;
  videoUrl: string;
  observedAt: Date;
  fetcher?: typeof fetch;
}, dependencyOverrides: Partial<RenderCacheDependencies> = {}) {
  const client = dependencyOverrides.client ?? defaultPrisma;
  const readConfigSecret = dependencyOverrides.readConfigSecret ?? readAiConfigSecret;
  const createStorage = dependencyOverrides.createStorage ?? createOssPrivateMediaStorage;
  const url = new URL(input.videoUrl);
  if (url.protocol !== "https:") throw new Error("VIDEO_OUTPUT_URL_INVALID");
  const config = await client.mediaStorageConfig.findFirst({
    where: { enabled: true, providerKind: "ALI_OSS" },
    orderBy: { createdAt: "asc" }
  });
  if (!config) throw new Error("VIDEO_OUTPUT_STORAGE_NOT_CONFIGURED");
  const objectKey = deterministicVideoObjectKey(input.attemptId, config.id);
  const existing = await client.digitalHumanMediaAsset.findUnique({ where: { objectKey } });
  if (isReusableVideoAsset(existing, config.id, input.observedAt)) {
    return { assetId: existing.id, objectKey, created: false };
  }
  const response = await (input.fetcher ?? fetch)(url, { redirect: "error" });
  if (!response.ok) throw new Error("VIDEO_OUTPUT_DOWNLOAD_FAILED");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "video/mp4") throw new Error("VIDEO_OUTPUT_CONTENT_TYPE_INVALID");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxVideoBytes) throw new Error("VIDEO_OUTPUT_TOO_LARGE");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > maxVideoBytes) throw new Error("VIDEO_OUTPUT_TOO_LARGE");
  const expiresAt = new Date(input.observedAt.getTime() + outputLifetimeMs);
  const storage = createStorage(config, readConfigSecret());
  const uploaded = await storage.putObject({
    purpose: "VIDEO_OUTPUT",
    body,
    contentType: "video/mp4",
    expiresAt,
    objectKey
  });
  const asset = await client.$transaction((tx) => tx.digitalHumanMediaAsset.upsert({
    where: { objectKey },
    create: {
      storageConfigId: config.id,
      objectKey: uploaded.objectKey,
      mimeType: "video/mp4",
      byteLength: uploaded.byteLength,
      purpose: "VIDEO_OUTPUT",
      expiresAt
    },
    update: {
      storageConfigId: config.id,
      mimeType: "video/mp4",
      byteLength: uploaded.byteLength,
      purpose: "VIDEO_OUTPUT",
      expiresAt,
      cleanupStatus: "ACTIVE",
      cleanedAt: null
    }
  }));
  return { assetId: asset.id, objectKey, created: existing === null };
}

export function deterministicVideoObjectKey(attemptId: string, storageConfigId: string) {
  const digest = createHash("sha256")
    .update(storageConfigId)
    .update("\0")
    .update(attemptId)
    .digest("hex");
  return `media/video/render/${digest}.mp4`;
}

type RenderCacheDependencies = {
  client: PrismaClient;
  readConfigSecret: () => string;
  createStorage: (
    config: MediaStorageConfigRecord,
    configSecret: string
  ) => Pick<PrivateMediaStorage, "putObject">;
};

type ReusableVideoAsset = {
  id: string;
  storageConfigId: string;
  mimeType: string;
  byteLength: number;
  purpose: string;
  expiresAt: Date | null;
  cleanupStatus: string;
};

function isReusableVideoAsset(
  asset: ReusableVideoAsset | null,
  storageConfigId: string,
  observedAt: Date
): asset is ReusableVideoAsset {
  return asset?.storageConfigId === storageConfigId &&
    asset.purpose === "VIDEO_OUTPUT" &&
    asset.mimeType === "video/mp4" &&
    asset.byteLength > 0 &&
    asset.cleanupStatus === "ACTIVE" &&
    asset.expiresAt !== null &&
    asset.expiresAt > observedAt;
}

import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import type { MediaStorageConfigRecord, PrivateMediaStorage } from "@/lib/media/storage/types";

const maxVideoBytes = 100 * 1024 * 1024;
const outputLifetimeMs = 23 * 60 * 60 * 1000;

export async function cacheProviderVideoOutput(input: {
  attemptId: string;
  claimToken?: string;
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
  const objectKey = videoGenerationObjectKey(input.attemptId, config.id, randomUUID());
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
  const persisted = await client.$transaction(async (tx) => {
    const asset = await tx.digitalHumanMediaAsset.create({
      data: {
        id: randomUUID(),
        storageConfigId: config.id,
        objectKey: uploaded.objectKey,
        mimeType: "video/mp4",
        byteLength: uploaded.byteLength,
        purpose: "VIDEO_OUTPUT",
        expiresAt
      }
    });
    if (!input.claimToken) return { asset, attached: undefined };
    const attached = await tx.digitalHumanRenderAttempt.updateMany({
      where: {
        id: input.attemptId,
        status: "CACHING",
        claimOperation: "CACHE",
        claimToken: input.claimToken
      },
      data: {
        status: "SUCCEEDED",
        outputAssetId: asset.id,
        outputUrlCiphertext: null,
        outputUrlIv: null,
        outputUrlTag: null,
        claimOperation: null,
        claimToken: null,
        claimExpiresAt: null
      }
    });
    return { asset, attached: attached.count === 1 };
  });
  return { assetId: persisted.asset.id, objectKey, created: true, attached: persisted.attached };
}

export function deterministicVideoObjectKey(attemptId: string, storageConfigId: string) {
  return `media/video/render/${deterministicVideoCacheIdentity(attemptId, storageConfigId)}.mp4`;
}

export function videoGenerationObjectKey(attemptId: string, storageConfigId: string, generationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generationId)) {
    throw new Error("VIDEO_OUTPUT_GENERATION_ID_INVALID");
  }
  return `media/video/render/${deterministicVideoCacheIdentity(attemptId, storageConfigId)}/${generationId.toLowerCase()}.mp4`;
}

function deterministicVideoCacheIdentity(attemptId: string, storageConfigId: string) {
  return createHash("sha256")
    .update(storageConfigId)
    .update("\0")
    .update(attemptId)
    .digest("hex");
}

type RenderCacheDependencies = {
  client: PrismaClient;
  readConfigSecret: () => string;
  createStorage: (
    config: MediaStorageConfigRecord,
    configSecret: string
  ) => Pick<PrivateMediaStorage, "putObject">;
};

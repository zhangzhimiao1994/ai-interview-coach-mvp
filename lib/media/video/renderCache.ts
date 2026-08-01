import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { persistDigitalHumanMediaAsset } from "@/lib/media/storage/mediaAssets";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";

const maxVideoBytes = 100 * 1024 * 1024;
const outputLifetimeMs = 24 * 60 * 60 * 1000;

export async function cacheProviderVideoOutput(input: {
  attemptId: string;
  videoUrl: string;
  observedAt: Date;
  fetcher?: typeof fetch;
}) {
  const url = new URL(input.videoUrl);
  if (url.protocol !== "https:") throw new Error("VIDEO_OUTPUT_URL_INVALID");
  const config = await prisma.mediaStorageConfig.findFirst({
    where: { enabled: true, providerKind: "ALI_OSS" },
    orderBy: { createdAt: "asc" }
  });
  if (!config) throw new Error("VIDEO_OUTPUT_STORAGE_NOT_CONFIGURED");
  const objectKey = deterministicVideoObjectKey(input.attemptId);
  const existing = await prisma.digitalHumanMediaAsset.findUnique({ where: { objectKey } });
  if (existing?.cleanupStatus === "ACTIVE") {
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
  const storage = createOssPrivateMediaStorage(config, readAiConfigSecret());
  const uploaded = await storage.putObject({
    purpose: "VIDEO_OUTPUT",
    body,
    contentType: "video/mp4",
    expiresAt,
    objectKey
  });
  try {
    const asset = await persistDigitalHumanMediaAsset({
      storageConfigId: config.id,
      objectKey: uploaded.objectKey,
      mimeType: "video/mp4",
      byteLength: uploaded.byteLength,
      purpose: "VIDEO_OUTPUT",
      expiresAt
    });
    return { assetId: asset.id, objectKey, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.digitalHumanMediaAsset.findUnique({ where: { objectKey } });
      if (raced?.cleanupStatus === "ACTIVE") {
        return { assetId: raced.id, objectKey, created: false };
      }
    }
    await storage.removeObject(uploaded.objectKey).catch(() => undefined);
    throw error;
  }
}

export function deterministicVideoObjectKey(attemptId: string) {
  const digest = createHash("sha256").update(attemptId).digest("hex");
  return `media/video/render/${digest}.mp4`;
}

export async function discardCachedVideoOutput(input: {
  assetId: string;
  objectKey?: string;
  created?: boolean;
}) {
  if (input.created === false) return;
  const asset = await prisma.digitalHumanMediaAsset.findUnique({ where: { id: input.assetId } });
  if (!asset || (input.objectKey && asset.objectKey !== input.objectKey)) return;
  const references = await prisma.digitalHumanRenderAttempt.count({ where: { outputAssetId: asset.id } });
  if (references > 0) return;
  const config = await prisma.mediaStorageConfig.findUnique({ where: { id: asset.storageConfigId } });
  await prisma.digitalHumanMediaAsset.deleteMany({ where: { id: asset.id } });
  if (config?.enabled) {
    await createOssPrivateMediaStorage(config, readAiConfigSecret()).removeObject(asset.objectKey);
  }
}

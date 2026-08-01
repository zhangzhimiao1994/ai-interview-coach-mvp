import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { persistDigitalHumanMediaAsset } from "@/lib/media/storage/mediaAssets";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";

const maxVideoBytes = 100 * 1024 * 1024;
const outputLifetimeMs = 24 * 60 * 60 * 1000;

export async function cacheProviderVideoOutput(input: {
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
    expiresAt
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
    return { assetId: asset.id };
  } catch (error) {
    await storage.removeObject(uploaded.objectKey).catch(() => undefined);
    throw error;
  }
}

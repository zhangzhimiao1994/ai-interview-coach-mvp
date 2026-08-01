import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import { persistDigitalHumanMediaAsset } from "@/lib/media/storage/mediaAssets";
import { authorizeAdminRequest, requestHasTrustedOrigin, type AuthorizedAdmin } from "@/lib/security/adminRouteAuth";

const maximumPortraitBytes = 5 * 1024 * 1024;
export type PortraitUploadInput = { body: Buffer; contentType: "image/png" | "image/jpeg"; width: number; height: number };
type UploadedPortrait = { objectKey: string; byteLength: number; storageConfigId?: string };
export type PortraitUploadDependencies = {
  authorizeAdmin: (request: Request) => Promise<AuthorizedAdmin | null>;
  uploadPrivate: (input: PortraitUploadInput) => Promise<UploadedPortrait>;
  persistAsset: (input: PortraitUploadInput & UploadedPortrait & { expiresAt: null }) => Promise<{ id: string }>;
  removePrivate: (objectKey: string, storageConfigId?: string) => Promise<void>;
};

export function createPortraitUploadHandler(overrides: Partial<PortraitUploadDependencies> = {}) {
  const deps: PortraitUploadDependencies = {
    authorizeAdmin: authorizeAdminRequest,
    uploadPrivate: async (input) => {
      const selected = await defaultStorage();
      return { ...(await selected.storage.putObject({ purpose: "PORTRAIT", body: input.body, contentType: input.contentType, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })), storageConfigId: selected.config.id };
    },
    persistAsset: async (input) => {
      if (!input.storageConfigId) throw new Error("storage context missing");
      return persistDigitalHumanMediaAsset({ storageConfigId: input.storageConfigId, objectKey: input.objectKey, mimeType: input.contentType, byteLength: input.byteLength, purpose: "PORTRAIT", expiresAt: null });
    },
    removePrivate: async (key, storageConfigId) => { if (!storageConfigId) throw new Error("storage context missing"); const config = await prisma.mediaStorageConfig.findUnique({ where: { id: storageConfigId } }); if (!config) throw new Error("storage unavailable"); await createOssPrivateMediaStorage(config, readAiConfigSecret()).removeObject(key); },
    ...overrides
  };
  return async function handler(request: Request) {
    const actor = await deps.authorizeAdmin(request).catch(() => null);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!requestHasTrustedOrigin(request)) return json({ error: "CSRF validation failed" }, 403);
    let file: File;
    try {
      const value = (await request.formData()).get("portrait");
      if (!(value instanceof File) || value.size <= 0 || value.size > maximumPortraitBytes) throw new Error("invalid file");
      file = value;
    } catch { return json({ error: "Validation failed" }, 400); }
    const body = Buffer.from(await file.arrayBuffer());
    const metadata = inspectImage(body);
    if (!metadata || metadata.width < 400 || metadata.height < 400 || metadata.width > 7000 || metadata.height > 7000) return json({ error: "Validation failed" }, 400);
    let uploaded: UploadedPortrait;
    try { uploaded = await deps.uploadPrivate({ body, ...metadata }); }
    catch { return json({ error: "Upload failed" }, 503); }
    try {
      const asset = await deps.persistAsset({ body, ...metadata, ...uploaded, expiresAt: null });
      return json({ asset: { id: asset.id, mimeType: metadata.contentType, width: metadata.width, height: metadata.height } }, 201);
    } catch {
      await deps.removePrivate(uploaded.objectKey, uploaded.storageConfigId).catch(() => undefined);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

export function inspectImage(body: Buffer): { contentType: "image/png" | "image/jpeg"; width: number; height: number } | null {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (body.length >= 45 && body.subarray(0, 8).equals(pngSignature)) {
    if (body.readUInt32BE(8) !== 13 || body.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    let offset = 8; let hasEnd = false; let hasIdat = false; let chunkIndex = 0;
    while (offset + 12 <= body.length) {
      const length = body.readUInt32BE(offset); if (length > maximumPortraitBytes || offset + 12 + length > body.length) return null;
      const type = body.subarray(offset + 4, offset + 8).toString("ascii");
      if (chunkIndex === 0 && type !== "IHDR") return null;
      if (!["IHDR", "PLTE", "IDAT", "IEND"].includes(type) && /^[A-Z]/.test(type)) return null;
      if (type === "IDAT") hasIdat = true;
      offset += 12 + length; chunkIndex += 1;
      if (type === "IEND") { hasEnd = length === 0 && offset === body.length; break; }
    }
    if (!hasEnd || !hasIdat) return null;
    return { contentType: "image/png", width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  }
  if (body.length >= 12 && body[0] === 0xff && body[1] === 0xd8 && body.at(-2) === 0xff && body.at(-1) === 0xd9) {
    let offset = 2; let dimensions: { width: number; height: number } | null = null; let hasScan = false;
    while (offset + 4 < body.length - 2) {
      if (body[offset] !== 0xff) return null;
      const marker = body[offset + 1]; offset += 2;
      const length = body.readUInt16BE(offset); if (length < 2 || offset + length > body.length - 2) return null;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) dimensions = { height: body.readUInt16BE(offset + 3), width: body.readUInt16BE(offset + 5) };
      if (marker === 0xda) { hasScan = true; break; }
      offset += length;
    }
    if (dimensions && hasScan) return { contentType: "image/jpeg", ...dimensions };
  }
  return null;
}

async function defaultStorage() {
  const config = await prisma.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS", enabled: true }, orderBy: { updatedAt: "desc" } });
  if (!config) throw new Error("storage not configured");
  return { config, storage: createOssPrivateMediaStorage(config, readAiConfigSecret()) };
}
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

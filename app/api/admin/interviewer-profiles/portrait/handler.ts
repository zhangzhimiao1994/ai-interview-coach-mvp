import { NextResponse } from "next/server";
import { inflateSync } from "node:zlib";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import { persistDigitalHumanMediaAsset } from "@/lib/media/storage/mediaAssets";
import { authorizeAdminRequest, requestHasTrustedOrigin, type AuthorizedAdmin } from "@/lib/security/adminRouteAuth";

const maximumPortraitBytes = 5 * 1024 * 1024;
const maximumDecodedPortraitBytes = 64 * 1024 * 1024;
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
      return persistDigitalHumanMediaAsset({ storageConfigId: input.storageConfigId, objectKey: input.objectKey, mimeType: input.contentType, byteLength: input.byteLength, purpose: "PORTRAIT", portraitWidth: input.width, portraitHeight: input.height, expiresAt: null });
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
    const width = body.readUInt32BE(16); const height = body.readUInt32BE(20);
    const bitDepth = body[24]; const colorType = body[25];
    if (!validPortraitDimensions(width, height) || !validPngFormat(bitDepth, colorType) || body[26] !== 0 || body[27] !== 0 || body[28] !== 0) return null;
    let offset = 8; let hasEnd = false; let hasIdat = false; let chunkIndex = 0; let idatEnded = false; let hasPalette = false;
    const idat: Buffer[] = [];
    while (offset + 12 <= body.length) {
      const length = body.readUInt32BE(offset); if (length > maximumPortraitBytes || offset + 12 + length > body.length) return null;
      const type = body.subarray(offset + 4, offset + 8).toString("ascii");
      if (!/^[A-Za-z]{4}$/.test(type)) return null;
      const payloadEnd = offset + 8 + length;
      if (body.readUInt32BE(payloadEnd) !== crc32(body.subarray(offset + 4, payloadEnd))) return null;
      if (chunkIndex === 0 && type !== "IHDR") return null;
      if (!["IHDR", "PLTE", "IDAT", "IEND"].includes(type) && /^[A-Z]/.test(type)) return null;
      if (type === "PLTE") { if (hasIdat || length === 0 || length % 3 !== 0) return null; hasPalette = true; }
      if (type === "IDAT") { if (idatEnded || length === 0) return null; hasIdat = true; idat.push(body.subarray(offset + 8, payloadEnd)); }
      else if (hasIdat) idatEnded = true;
      offset += 12 + length; chunkIndex += 1;
      if (type === "IEND") { hasEnd = length === 0 && offset === body.length; break; }
    }
    if (!hasEnd || !hasIdat || (colorType === 3 && !hasPalette)) return null;
    const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
    const rowBytes = Math.ceil(width * channels * bitDepth / 8); const expectedLength = height * (rowBytes + 1);
    if (!withinPortraitDecodedBudget(width, height, channels, bitDepth)) return null;
    let decoded: Buffer;
    try { decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedLength + 1 }); } catch { return null; }
    if (decoded.length !== expectedLength) return null;
    for (let row = 0; row < height; row += 1) if (decoded[row * (rowBytes + 1)] > 4) return null;
    return { contentType: "image/png", width, height };
  }
  if (body.length >= 12 && body[0] === 0xff && body[1] === 0xd8 && body.at(-2) === 0xff && body.at(-1) === 0xd9) {
    let offset = 2; let dimensions: { width: number; height: number } | null = null; let hasDqt = false; let hasDht = false;
    while (offset + 4 < body.length - 2) {
      if (body[offset] !== 0xff) return null;
      while (body[offset] === 0xff) offset += 1;
      const marker = body[offset]; offset += 1;
      if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null;
      if (offset + 2 > body.length - 2) return null;
      const length = body.readUInt16BE(offset); if (length < 2 || offset + length > body.length - 2) return null;
      const payload = body.subarray(offset + 2, offset + length);
      if (marker === 0xdb) { if (!validJpegDqt(payload)) return null; hasDqt = true; }
      if (marker === 0xc4) { if (!validJpegDht(payload)) return null; hasDht = true; }
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 11 || payload[0] !== 8 || payload.length !== 6 + payload[5] * 3) return null;
        dimensions = { height: body.readUInt16BE(offset + 3), width: body.readUInt16BE(offset + 5) };
        if (!validPortraitDimensions(dimensions.width, dimensions.height)) return null;
      }
      if (marker === 0xda) {
        if (!dimensions || !hasDqt || !hasDht || length < 8) return null;
        let scan = offset + length; let entropyBytes = 0;
        while (scan < body.length - 1) {
          if (body[scan] !== 0xff) { entropyBytes += 1; scan += 1; continue; }
          const next = body[scan + 1];
          if (next === 0x00) { entropyBytes += 1; scan += 2; continue; }
          if (next >= 0xd0 && next <= 0xd7) { scan += 2; continue; }
          return next === 0xd9 && scan === body.length - 2 && entropyBytes >= 2 ? { contentType: "image/jpeg", ...dimensions } : null;
        }
        return null;
      }
      offset += length;
    }
  }
  return null;
}

function validPortraitDimensions(width: number, height: number) { return width >= 400 && height >= 400 && width <= 7000 && height <= 7000; }
export function withinPortraitDecodedBudget(width: number, height: number, channels: number, bitDepth: number) {
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const decodedBytes = height * (rowBytes + 1);
  return Number.isSafeInteger(decodedBytes) && decodedBytes <= maximumDecodedPortraitBytes;
}
function validPngFormat(bitDepth: number, colorType: number) {
  const allowed: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  return Boolean(allowed[colorType]?.includes(bitDepth));
}
function validJpegDqt(payload: Buffer) { let offset = 0; while (offset < payload.length) { const precision = payload[offset] >> 4; if (precision > 1) return false; offset += 1 + (precision === 0 ? 64 : 128); } return offset === payload.length; }
function validJpegDht(payload: Buffer) { let offset = 0; while (offset < payload.length) { if (offset + 17 > payload.length) return false; const symbols = payload.subarray(offset + 1, offset + 17).reduce((sum, value) => sum + value, 0); if (symbols === 0 || offset + 17 + symbols > payload.length) return false; offset += 17 + symbols; } return offset === payload.length; }
function crc32(value: Buffer) { let crc = 0xffffffff; for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }

async function defaultStorage() {
  const config = await prisma.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS", enabled: true }, orderBy: { updatedAt: "desc" } });
  if (!config) throw new Error("storage not configured");
  return { config, storage: createOssPrivateMediaStorage(config, readAiConfigSecret()) };
}
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

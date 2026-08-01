import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { resolveMediaModelById } from "@/lib/media/config";
import { encryptOssCredentials, serializeMediaStorageConfig } from "@/lib/media/storage/ossCredentials";
import { digitalHumanVideoRuntimeSettingKey } from "@/lib/media/video/diagnostics";
import { assertCompatibleVideoModel, type CompatibleVideoModel, type VideoModelSlot } from "@/lib/media/video/modelCompatibility";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";
import { digitalHumanVideoRuntimeSettingsSchema } from "@/lib/validators/digitalHumanVideo";
import { authorizeAdminRequest, requestHasTrustedOrigin, type AuthorizedAdmin } from "@/lib/security/adminRouteAuth";
import { Prisma, type DigitalHumanMediaAsset, type InterviewerAvatarProfile, type PrismaClient } from "@prisma/client";

const storageSchema = z.object({
  id: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).max(100),
  endpoint: z.string().trim().min(3).max(255).regex(/^[A-Za-z0-9.-]+$/),
  bucket: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  region: z.string().trim().min(1).max(100).nullable(),
  enabled: z.boolean(),
  credentials: z.object({ accessKeyId: z.string().trim().min(1), accessKeySecret: z.string().trim().min(1), securityToken: z.string().trim().min(1).optional() }).strict().optional()
}).strict();

const runtimePutSchema = z.object({ runtime: digitalHumanVideoRuntimeSettingsSchema, storage: storageSchema.nullable() }).strict();
const storagePutSchema = z.object({ action: z.literal("SAVE_STORAGE"), storage: storageSchema }).strict();
const putSchema = z.union([runtimePutSchema, storagePutSchema]);
export type RuntimeConfigInput = z.infer<typeof putSchema>;
export class RuntimeConfigValidationError extends Error {}
type SafeVideoModel = { id: string; displayName: string; modelName: string; providerType: string; slot: VideoModelSlot };
export type SafeRuntimeConfig = { runtime: ReturnType<typeof safeRuntime>; storage: ReturnType<typeof serializeMediaStorageConfig> | null; profiles: Array<ReturnType<typeof safeProfile>>; models: SafeVideoModel[] };

export type RuntimeRouteDependencies = {
  authorizeAdmin: (request: Request) => Promise<AuthorizedAdmin | null>;
  loadConfig: () => Promise<SafeRuntimeConfig>;
  saveConfig: (input: z.infer<typeof runtimePutSchema>) => Promise<SafeRuntimeConfig>;
  saveStorage: (input: z.infer<typeof storageSchema>) => Promise<SafeRuntimeConfig>;
};

export function createDigitalHumanVideoRuntimeHandler(overrides: Partial<RuntimeRouteDependencies> = {}) {
  const deps: RuntimeRouteDependencies = {
    authorizeAdmin: authorizeAdminRequest,
    loadConfig: () => loadDigitalHumanVideoConfig(),
    saveConfig: (input) => saveDigitalHumanVideoRuntime(input),
    saveStorage: (input) => saveDigitalHumanVideoStorage(input),
    ...overrides
  };
  return async function handler(request: Request) {
    const actor = await deps.authorizeAdmin(request).catch(() => null);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (request.method === "GET") return json(await deps.loadConfig(), 200);
    if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
    if (!requestHasTrustedOrigin(request)) return json({ error: "CSRF validation failed" }, 403);
    try {
      const input = putSchema.parse(await request.json());
      return json("action" in input ? await deps.saveStorage(input.storage) : await deps.saveConfig(input), 200);
    } catch (error) {
      if (error instanceof RuntimeConfigValidationError && error.message === "STALE_STORAGE_CONFIG") {
        return json({ error: "STALE_STORAGE_CONFIG" }, 409);
      }
      if (error instanceof z.ZodError || error instanceof RuntimeConfigValidationError) return json({ error: "Validation failed" }, 400);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

export async function loadDigitalHumanVideoConfig(database: PrismaClient = prisma): Promise<SafeRuntimeConfig> {
  const [runtimeRow, storage, profiles, models] = await Promise.all([
    database.aiRuntimeSetting.findUnique({ where: { key: digitalHumanVideoRuntimeSettingKey } }),
    database.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS", enabled: true }, orderBy: { updatedAt: "desc" } }),
    database.interviewerAvatarProfile.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, displayName: true, voice: true, styleJson: true, portraitAssetId: true, portraitAsset: { select: { purpose: true, cleanupStatus: true, portraitWidth: true, portraitHeight: true } }, lingmouMappingJson: true, emoMappingJson: true, providerRole: true, enabled: true } }),
    database.aiModelConfig.findMany({ where: { capability: "DIGITAL_HUMAN_VIDEO" }, orderBy: { createdAt: "asc" }, include: { provider: true } })
  ]);
  const compatibleModels = (await Promise.all(models.map(async (model): Promise<SafeVideoModel | null> => {
    const slot = model.provider.providerType === "LINGMOU" ? "LINGMOU_BROADCAST" : model.provider.providerType === "TONGYI" ? "ALIBABA_EMO" : null;
    if (!slot) return null;
    try {
      const resolved = await resolveMediaModelById(model.id, "DIGITAL_HUMAN_VIDEO", async () => model);
      assertCompatibleVideoModel(resolved, slot, readAiConfigSecret);
      return { id: model.id, displayName: model.displayName, modelName: model.modelName, providerType: model.provider.providerType, slot };
    } catch { return null; }
  }))).filter((model): model is SafeVideoModel => model !== null);
  return {
    runtime: safeRuntime(runtimeRow?.valueJson),
    storage: storage ? serializeMediaStorageConfig(storage) : null,
    profiles: profiles.map(safeProfile),
    models: compatibleModels
  };
}

export async function saveDigitalHumanVideoRuntime(input: z.infer<typeof runtimePutSchema>, database: PrismaClient = prisma) {
  await database.$transaction(async (tx) => {
    const [lingmou, emo, profiles] = await Promise.all([
      resolveCompatibleModel(input.runtime.lingmouModelId, "LINGMOU_BROADCAST", tx),
      resolveCompatibleModel(input.runtime.emoModelId, "ALIBABA_EMO", tx),
      tx.interviewerAvatarProfile.findMany({ where: { id: { in: [input.runtime.primaryProfileId, ...(input.runtime.secondaryProfileId ? [input.runtime.secondaryProfileId] : [])] } }, include: { portraitAsset: true } })
    ]);
    const requiredIds = input.runtime.synchronizeProfiles ? [input.runtime.primaryProfileId] : [input.runtime.primaryProfileId, input.runtime.secondaryProfileId!];
    if (new Set(requiredIds).size !== requiredIds.length || profiles.length !== requiredIds.length || profiles.some((profile) => !profileCompatible(profile, lingmou, emo))) throw new RuntimeConfigValidationError("PROFILE_INCOMPLETE");

    if (input.storage) {
      await persistStorage(input.storage, tx, readAiConfigSecret());
    } else {
      const existingStorage = await tx.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS", enabled: true } });
      if (!existingStorage || !completeStorageEnvelope(existingStorage)) throw new RuntimeConfigValidationError("OSS_STORAGE_REQUIRED");
    }
    await tx.aiRuntimeSetting.upsert({
      where: { key: digitalHumanVideoRuntimeSettingKey },
      create: { key: digitalHumanVideoRuntimeSettingKey, valueJson: JSON.stringify(input.runtime) },
      update: { valueJson: JSON.stringify(input.runtime) }
    });
  });
  return loadDigitalHumanVideoConfig(database);
}

export async function saveDigitalHumanVideoStorage(storage: z.infer<typeof storageSchema>, database: PrismaClient = prisma, configSecret: string = readAiConfigSecret()) {
  await database.$transaction(async (tx) => {
    await persistStorage(storage, tx, configSecret);
  });
  return loadDigitalHumanVideoConfig(database);
}

type PortraitAssetFields = Pick<DigitalHumanMediaAsset, "purpose" | "cleanupStatus" | "portraitWidth" | "portraitHeight">;
type ProfileFields = Pick<InterviewerAvatarProfile, "id" | "displayName" | "voice" | "styleJson" | "portraitAssetId" | "lingmouMappingJson" | "emoMappingJson" | "providerRole" | "enabled"> & { portraitAsset: PortraitAssetFields | null };
function profileCompatible(profile: ProfileFields | undefined, lingmou: CompatibleVideoModel, emoModel: CompatibleVideoModel) {
  if (!profile?.enabled || !validPortraitAsset(profile.portraitAsset) || !profile.displayName?.trim() || !/^[A-Za-z0-9_.-]{1,100}$/.test(profile.voice?.trim())) return false;
  try {
    const ling = JSON.parse(profile.lingmouMappingJson); const emoMapping = JSON.parse(profile.emoMappingJson); const style = JSON.parse(profile.styleJson);
    const lingConfig = lingmou.slot === "LINGMOU_BROADCAST" ? lingmou.configuration : null;
    const emoConfig = emoModel.slot === "ALIBABA_EMO" ? emoModel.configuration : null;
    return Boolean(style && lingConfig && emoConfig &&
      ling?.templateId === lingConfig.templateId && ling?.audioVariableName === lingConfig.audioVariableName && (ling?.portraitVariableName ?? null) === lingConfig.portraitVariableName &&
      emoMapping?.portraitWidth === profile.portraitAsset.portraitWidth && emoMapping?.portraitHeight === profile.portraitAsset.portraitHeight);
  } catch { return false; }
}

function profileComplete(profile: ProfileFields | undefined) {
  if (!profile?.enabled || !validPortraitAsset(profile.portraitAsset) || !profile.displayName?.trim() || !/^[A-Za-z0-9_.-]{1,100}$/.test(profile.voice?.trim())) return false;
  try {
    const ling = JSON.parse(profile.lingmouMappingJson); const emo = JSON.parse(profile.emoMappingJson); const style = JSON.parse(profile.styleJson);
    return Boolean(style && ling?.templateId && ling?.audioVariableName && emo?.portraitWidth === profile.portraitAsset.portraitWidth && emo?.portraitHeight === profile.portraitAsset.portraitHeight);
  } catch { return false; }
}

async function resolveCompatibleModel(modelId: string, slot: VideoModelSlot, database: Prisma.TransactionClient) {
  try {
    const model = await resolveMediaModelById(modelId, "DIGITAL_HUMAN_VIDEO", (id) => database.aiModelConfig.findUnique({ where: { id }, include: { provider: true } }));
    return assertCompatibleVideoModel(model, slot, readAiConfigSecret);
  } catch { throw new RuntimeConfigValidationError("MODEL_PROVIDER_MISMATCH"); }
}

async function persistStorage(storage: z.infer<typeof storageSchema>, database: Prisma.TransactionClient, configSecret: string) {
  if (!storage.enabled) throw new RuntimeConfigValidationError("OSS_STORAGE_DISABLED");
  const existing = storage.id ? await database.mediaStorageConfig.findUnique({ where: { id: storage.id } }) : null;
  if (storage.id && !existing) throw new RuntimeConfigValidationError("OSS_STORAGE_NOT_FOUND");
  if (existing && existing.providerKind !== "ALI_OSS") throw new RuntimeConfigValidationError("OSS_STORAGE_KIND_INVALID");
  if (existing && !existing.enabled) throw staleStorageConfig();
  if (!storage.credentials && (!existing || !completeStorageEnvelope(existing))) throw new RuntimeConfigValidationError("OSS_CREDENTIALS_REQUIRED");
  const encrypted = storage.credentials ? encryptOssCredentials(storage.credentials, configSecret) : null;
  const data = { displayName: storage.displayName, providerKind: "ALI_OSS", endpoint: storage.endpoint, bucket: storage.bucket, region: storage.region, enabled: true, ...(encrypted ? { credentialsCiphertext: encrypted.ciphertext, credentialsIv: encrypted.iv, credentialsTag: encrypted.tag, credentialsPreviewJson: encrypted.previewJson } : {}) };
  const identityChanged = Boolean(existing && (
    existing.endpoint !== storage.endpoint ||
    existing.bucket !== storage.bucket ||
    existing.region !== storage.region ||
    storage.credentials
  ));
  try {
    if (existing && identityChanged) {
      const archivedName = `${existing.displayName} [archived:${existing.id}]`;
      const disabled = await database.mediaStorageConfig.updateMany({
        where: { id: existing.id, providerKind: "ALI_OSS", enabled: true },
        data: { displayName: archivedName, enabled: false }
      });
      if (disabled.count !== 1) throw staleStorageConfig();
      await database.mediaStorageConfig.create({ data: {
        ...data,
        credentialsCiphertext: encrypted?.ciphertext ?? existing.credentialsCiphertext,
        credentialsIv: encrypted?.iv ?? existing.credentialsIv,
        credentialsTag: encrypted?.tag ?? existing.credentialsTag,
        credentialsPreviewJson: encrypted?.previewJson ?? existing.credentialsPreviewJson
      } });
    } else if (existing) {
      const updated = await database.mediaStorageConfig.updateMany({
        where: { id: existing.id, providerKind: "ALI_OSS", enabled: true },
        data
      });
      if (updated.count !== 1) throw staleStorageConfig();
    } else {
      await database.mediaStorageConfig.create({ data });
    }
  } catch (error) {
    if (error instanceof RuntimeConfigValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw staleStorageConfig();
    }
    throw error;
  }
}

function staleStorageConfig() {
  return new RuntimeConfigValidationError("STALE_STORAGE_CONFIG");
}

function completeStorageEnvelope(storage: { credentialsCiphertext: string | null; credentialsIv: string | null; credentialsTag: string | null }) {
  return Boolean(storage.credentialsCiphertext && storage.credentialsIv && storage.credentialsTag);
}

function validPortraitAsset(asset: PortraitAssetFields | null | undefined): asset is PortraitAssetFields & { portraitWidth: number; portraitHeight: number } {
  return Boolean(asset && asset.purpose === "PORTRAIT" && asset.cleanupStatus === "ACTIVE" && Number.isInteger(asset.portraitWidth) && Number(asset.portraitWidth) >= 400 && Number(asset.portraitWidth) <= 7000 && Number.isInteger(asset.portraitHeight) && Number(asset.portraitHeight) >= 400 && Number(asset.portraitHeight) <= 7000);
}

function safeRuntime(value?: string) { try { return value ? parseDigitalHumanVideoRuntimeSettings(value) : null; } catch { return null; } }
function safeProfile(profile: ProfileFields) { return { id: profile.id, displayName: profile.displayName, voice: profile.voice, style: safeObject(profile.styleJson), portraitAssetId: profile.portraitAssetId, lingmouMapping: safeObject(profile.lingmouMappingJson), emoMapping: safeObject(profile.emoMappingJson), providerRole: profile.providerRole, enabled: profile.enabled, complete: profileComplete(profile) }; }
function safeObject(value: string) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

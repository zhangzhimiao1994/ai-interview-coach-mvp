import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { encryptOssCredentials, serializeMediaStorageConfig } from "@/lib/media/storage/ossCredentials";
import { digitalHumanVideoRuntimeSettingKey } from "@/lib/media/video/diagnostics";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";
import { digitalHumanVideoRuntimeSettingsSchema } from "@/lib/validators/digitalHumanVideo";
import { authorizeAdminRequest, requestHasTrustedOrigin, type AuthorizedAdmin } from "@/lib/security/adminRouteAuth";
import type { AiModelConfig, AiServiceProvider, InterviewerAvatarProfile, PrismaClient } from "@prisma/client";

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
type SafeRuntimeConfig = { runtime: unknown; storage: unknown; profiles: unknown[]; models: unknown[] };

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
      if (error instanceof z.ZodError || error instanceof RuntimeConfigValidationError) return json({ error: "Validation failed" }, 400);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

export async function loadDigitalHumanVideoConfig(database: PrismaClient = prisma): Promise<SafeRuntimeConfig> {
  const [runtimeRow, storage, profiles, models] = await Promise.all([
    database.aiRuntimeSetting.findUnique({ where: { key: digitalHumanVideoRuntimeSettingKey } }),
    database.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS" }, orderBy: { updatedAt: "desc" } }),
    database.interviewerAvatarProfile.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, displayName: true, voice: true, styleJson: true, portraitAssetId: true, lingmouMappingJson: true, emoMappingJson: true, providerRole: true, enabled: true } }),
    database.aiModelConfig.findMany({ where: { capability: "DIGITAL_HUMAN_VIDEO" }, orderBy: { createdAt: "asc" }, select: { id: true, displayName: true, modelName: true, enabled: true, provider: { select: { providerType: true, enabled: true } } } })
  ]);
  return {
    runtime: safeRuntime(runtimeRow?.valueJson),
    storage: storage ? serializeMediaStorageConfig(storage) : null,
    profiles: profiles.map(safeProfile),
    models: models.filter((model) => model.enabled && model.provider.enabled).map((model) => ({ id: model.id, displayName: model.displayName, modelName: model.modelName, providerType: model.provider.providerType }))
  };
}

export async function saveDigitalHumanVideoRuntime(input: z.infer<typeof runtimePutSchema>, database: PrismaClient = prisma) {
  await database.$transaction(async (tx) => {
    const [models, profiles] = await Promise.all([
      tx.aiModelConfig.findMany({ where: { id: { in: [input.runtime.lingmouModelId, input.runtime.emoModelId] } }, include: { provider: true } }),
      tx.interviewerAvatarProfile.findMany({ where: { id: { in: [input.runtime.primaryProfileId, ...(input.runtime.secondaryProfileId ? [input.runtime.secondaryProfileId] : [])] } } })
    ]);
    const lingmou = models.find((model) => model.id === input.runtime.lingmouModelId);
    const emo = models.find((model) => model.id === input.runtime.emoModelId);
    if (!validModel(lingmou, "LINGMOU", "LINGMOU_BROADCAST") || !validModel(emo, "TONGYI", "ALIBABA_EMO")) throw new RuntimeConfigValidationError("MODEL_PROVIDER_MISMATCH");
    const requiredIds = input.runtime.synchronizeProfiles ? [input.runtime.primaryProfileId] : [input.runtime.primaryProfileId, input.runtime.secondaryProfileId!];
    if (new Set(requiredIds).size !== requiredIds.length || profiles.length !== requiredIds.length || profiles.some((profile) => !profileComplete(profile))) throw new RuntimeConfigValidationError("PROFILE_INCOMPLETE");

    if (input.storage) {
      if (!input.storage.enabled) throw new RuntimeConfigValidationError("OSS_STORAGE_DISABLED");
      const existing = input.storage.id ? await tx.mediaStorageConfig.findUnique({ where: { id: input.storage.id } }) : null;
      if (existing && existing.providerKind !== "ALI_OSS") throw new RuntimeConfigValidationError("OSS_STORAGE_KIND_INVALID");
      if (!existing && !input.storage.credentials) throw new RuntimeConfigValidationError("OSS_CREDENTIALS_REQUIRED");
      const encrypted = input.storage.credentials ? encryptOssCredentials(input.storage.credentials, readAiConfigSecret()) : null;
      const data = {
        displayName: input.storage.displayName, providerKind: "ALI_OSS", endpoint: input.storage.endpoint, bucket: input.storage.bucket,
        region: input.storage.region, enabled: input.storage.enabled,
        ...(encrypted ? { credentialsCiphertext: encrypted.ciphertext, credentialsIv: encrypted.iv, credentialsTag: encrypted.tag, credentialsPreviewJson: encrypted.previewJson } : {})
      };
      if (existing) await tx.mediaStorageConfig.update({ where: { id: existing.id }, data });
      else await tx.mediaStorageConfig.create({ data });
    } else {
      const existingStorage = await tx.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS", enabled: true } });
      if (!existingStorage) throw new RuntimeConfigValidationError("OSS_STORAGE_REQUIRED");
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
    if (!storage.enabled) throw new RuntimeConfigValidationError("OSS_STORAGE_DISABLED");
    const existing = storage.id ? await tx.mediaStorageConfig.findUnique({ where: { id: storage.id } }) : null;
    if (storage.id && !existing) throw new RuntimeConfigValidationError("OSS_STORAGE_NOT_FOUND");
    if (existing && existing.providerKind !== "ALI_OSS") throw new RuntimeConfigValidationError("OSS_STORAGE_KIND_INVALID");
    if ((!existing || !existing.credentialsCiphertext || !existing.credentialsIv || !existing.credentialsTag) && !storage.credentials) throw new RuntimeConfigValidationError("OSS_CREDENTIALS_REQUIRED");
    const encrypted = storage.credentials ? encryptOssCredentials(storage.credentials, configSecret) : null;
    const data = { displayName: storage.displayName, providerKind: "ALI_OSS", endpoint: storage.endpoint, bucket: storage.bucket, region: storage.region, enabled: true, ...(encrypted ? { credentialsCiphertext: encrypted.ciphertext, credentialsIv: encrypted.iv, credentialsTag: encrypted.tag, credentialsPreviewJson: encrypted.previewJson } : {}) };
    if (existing) await tx.mediaStorageConfig.update({ where: { id: existing.id }, data }); else await tx.mediaStorageConfig.create({ data });
  });
  return loadDigitalHumanVideoConfig(database);
}

type VideoModel = AiModelConfig & { provider: AiServiceProvider };
type ProfileFields = Pick<InterviewerAvatarProfile, "id" | "displayName" | "voice" | "styleJson" | "portraitAssetId" | "lingmouMappingJson" | "emoMappingJson" | "providerRole" | "enabled">;
function validModel(model: VideoModel | undefined, providerType: string, slot: "LINGMOU_BROADCAST" | "ALIBABA_EMO") {
  if (!model?.enabled || !model.provider?.enabled || model.capability !== "DIGITAL_HUMAN_VIDEO" || model.provider.providerType !== providerType || model.provider.providerType === "DUIX") return false;
  try {
    const settings = JSON.parse(model.settingsJson);
    return slot === "LINGMOU_BROADCAST"
      ? Boolean(settings?.templateId && settings?.audioVariableName && typeof settings?.watermark === "boolean" && Number.isInteger(settings?.fps))
      : settings?.model === "emo-v1" && ["1:1", "3:4"].includes(settings?.ratio);
  } catch { return false; }
}

function profileComplete(profile: ProfileFields | undefined) {
  if (!profile?.enabled || !profile.portraitAssetId || !profile.displayName?.trim() || !/^[A-Za-z0-9_.-]{1,100}$/.test(profile.voice?.trim())) return false;
  try {
    const ling = JSON.parse(profile.lingmouMappingJson); const emo = JSON.parse(profile.emoMappingJson); const style = JSON.parse(profile.styleJson);
    return Boolean(style && ling?.templateId && ling?.audioVariableName && Number.isInteger(emo?.portraitWidth) && Number.isInteger(emo?.portraitHeight));
  } catch { return false; }
}

function safeRuntime(value?: string) { try { return value ? parseDigitalHumanVideoRuntimeSettings(value) : null; } catch { return null; } }
function safeProfile(profile: ProfileFields) { return { id: profile.id, displayName: profile.displayName, voice: profile.voice, style: safeObject(profile.styleJson), portraitAssetId: profile.portraitAssetId, lingmouMapping: safeObject(profile.lingmouMappingJson), emoMapping: safeObject(profile.emoMappingJson), providerRole: profile.providerRole, enabled: profile.enabled, complete: profileComplete(profile) }; }
function safeObject(value: string) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

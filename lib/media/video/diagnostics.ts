import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import {
  resolveMediaModel,
  resolveMediaModelById,
  type ResolvedMediaModel
} from "@/lib/media/config";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import { validateAlibabaTtsConfiguration } from "@/lib/media/providers/alibabaTts";
import { decryptOssCredentials } from "@/lib/media/storage/ossCredentials";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import type { MediaStorageConfigRecord, PrivateMediaStorage } from "@/lib/media/storage/types";
import {
  createVideoSpeechAsset,
  parseVideoSpeechProfileStyle
} from "@/lib/media/video/speechAsset";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";
import type {
  DigitalHumanVideoRuntimeSettings,
  VideoAssetMetadata,
  VideoProviderKind,
  VideoSubmitInput
} from "@/lib/media/video/types";
import {
  createLingmouBroadcastProvider,
  resolveLingmouBroadcastConfiguration
} from "@/lib/media/video/providers/lingmouBroadcast";
import {
  createAlibabaEmoProvider,
  resolveAlibabaEmoConfiguration
} from "@/lib/media/video/providers/alibabaEmo";

export const digitalHumanVideoRuntimeSettingKey = "digital-human-video-runtime";

export type DigitalHumanVideoDiagnosticStatus =
  | "NOT_CONFIGURED"
  | "CONFIG_VALID"
  | "REACHABLE"
  | "PROVIDER_ERROR";

export type DigitalHumanVideoBillingOperation =
  | "ALIBABA_TTS_SYNTHESIS"
  | "LINGMOU_BROADCAST_SUBMISSION"
  | "ALIBABA_EMO_FACE_DETECTION"
  | "ALIBABA_EMO_VIDEO_SYNTHESIS";

export type DigitalHumanVideoCostSemantics =
  | "NO_PAID_OPERATION"
  | "POTENTIALLY_BILLABLE_OPERATIONS_COST_NOT_ESTIMATED";

export type DigitalHumanVideoDiagnosticRequest =
  | { mode: "CONFIG"; providerKind?: VideoProviderKind }
  | DigitalHumanVideoDiagnosticPaidRequest;

export interface DigitalHumanVideoDiagnosticPaidRequest {
  mode: "PAID";
  providerKind: VideoProviderKind;
  confirmPaidRequest: boolean | undefined;
}

export type DigitalHumanVideoDiagnosticResult = {
  status: DigitalHumanVideoDiagnosticStatus;
  code: string;
  providerKind: VideoProviderKind | null;
  traceId: string | null;
  checkedAt: string;
  billingOperations: DigitalHumanVideoBillingOperation[];
  costSemantics: DigitalHumanVideoCostSemantics;
};

export type DiagnosticInternalAsset = {
  objectKey: string;
  storageConfigId?: string;
  metadata: VideoAssetMetadata;
};

export type DiagnosticAuditRecord = {
  actorId: string;
  providerKind: VideoProviderKind;
  status: DigitalHumanVideoDiagnosticStatus;
  safeCode: string;
  traceId: string | null;
  checkedAt: Date;
  billingOperations: DigitalHumanVideoBillingOperation[];
  costSemantics: DigitalHumanVideoCostSemantics;
};

type ConfigurationInspection = {
  configured: boolean;
  safeCode: string;
  requiresPortrait: boolean;
  validatedProviders?: VideoProviderKind[];
};

export interface DigitalHumanVideoDiagnosticDependencies {
  inspectConfiguration: (providerKind?: VideoProviderKind) => Promise<ConfigurationInspection>;
  prepareAssets: (
    providerKind: VideoProviderKind,
    actorId: string,
    requiresPortrait: boolean
  ) => Promise<{ audio: DiagnosticInternalAsset; portrait: DiagnosticInternalAsset | null }>;
  createReadUrl: (asset: DiagnosticInternalAsset) => Promise<string>;
  submitLingmou: (input: VideoSubmitInput) => Promise<{
    upstreamTaskId: string;
    traceId: string | null;
  }>;
  submitEmo: (input: VideoSubmitInput) => Promise<{
    upstreamTaskId: string;
    traceId: string | null;
  }>;
  saveAudit: (audit: DiagnosticAuditRecord) => Promise<void>;
  now: () => Date;
}

export class DigitalHumanVideoDiagnosticInputError extends Error {
  constructor(readonly code: string) {
    super("Digital human video diagnostic request is invalid");
    this.name = "DigitalHumanVideoDiagnosticInputError";
  }
}

const statusAllowlist = new Set<DigitalHumanVideoDiagnosticStatus>([
  "NOT_CONFIGURED",
  "CONFIG_VALID",
  "REACHABLE",
  "PROVIDER_ERROR"
]);

const commonCodeAllowlist = new Set([
  "CONFIG_VALID",
  "REACHABLE",
  "VIDEO_DIAGNOSTIC_NOT_CONFIGURED",
  "VIDEO_PROFILE_NOT_CONFIGURED",
  "VIDEO_SPEECH_PROFILE_STYLE_INVALID",
  "VIDEO_DIAGNOSTIC_STORAGE_NOT_CONFIGURED",
  "VIDEO_DIAGNOSTIC_PORTRAIT_INVALID",
  "LINGMOU_PORTRAIT_NOT_CONFIGURED",
  "EMO_PORTRAIT_NOT_CONFIGURED"
]);

const providerCodeAllowlists: Record<VideoProviderKind, Set<string>> = {
  LINGMOU_BROADCAST: new Set([
    "LINGMOU_BROADCAST_AUTH_FAILED",
    "LINGMOU_BROADCAST_TEMPLATE_NOT_FOUND",
    "LINGMOU_BROADCAST_UPSTREAM_FAILED",
    "LINGMOU_BROADCAST_SUBMIT_INVALID_RESPONSE",
    "LINGMOU_BROADCAST_DIAGNOSTIC_FAILED"
  ]),
  ALIBABA_EMO: new Set([
    "ALIBABA_EMO_AUTH_FAILED",
    "ALIBABA_EMO_RATE_LIMITED",
    "ALIBABA_EMO_TIMEOUT",
    "ALIBABA_EMO_UPSTREAM_FAILED",
    "ALIBABA_EMO_DETECTION_INVALID_RESPONSE",
    "ALIBABA_EMO_DETECTION_GEOMETRY_INVALID",
    "ALIBABA_EMO_SUBMIT_INVALID_RESPONSE",
    "ALIBABA_EMO_DIAGNOSTIC_FAILED"
  ])
};

const billingOperationAllowlist = new Set<DigitalHumanVideoBillingOperation>([
  "ALIBABA_TTS_SYNTHESIS",
  "LINGMOU_BROADCAST_SUBMISSION",
  "ALIBABA_EMO_FACE_DETECTION",
  "ALIBABA_EMO_VIDEO_SYNTHESIS"
]);

export async function runDigitalHumanVideoDiagnostic(
  request: DigitalHumanVideoDiagnosticRequest,
  actorId: string,
  dependencyOverrides: Partial<DigitalHumanVideoDiagnosticDependencies> = {}
): Promise<DigitalHumanVideoDiagnosticResult> {
  if (!safeActorId(actorId)) {
    throw new DigitalHumanVideoDiagnosticInputError("DIAGNOSTIC_ACTOR_REQUIRED");
  }
  if (request.mode === "PAID" && request.confirmPaidRequest !== true) {
    throw new DigitalHumanVideoDiagnosticInputError("PAID_CONFIRMATION_REQUIRED");
  }

  const deps: DigitalHumanVideoDiagnosticDependencies = {
    inspectConfiguration: inspectDefaultConfiguration,
    prepareAssets: prepareDefaultAssets,
    createReadUrl: createDefaultReadUrl,
    submitLingmou: submitDefaultLingmou,
    submitEmo: submitDefaultEmo,
    saveAudit: saveDefaultAudit,
    now: () => new Date(),
    ...dependencyOverrides
  };
  const checkedAt = deps.now();
  let inspection: ConfigurationInspection;
  try {
    inspection = await deps.inspectConfiguration(request.providerKind);
  } catch {
    inspection = {
      configured: false,
      safeCode: "VIDEO_DIAGNOSTIC_NOT_CONFIGURED",
      requiresPortrait: request.providerKind === "ALIBABA_EMO"
    };
  }
  const configCode = sanitizeCode(
    inspection.safeCode,
    request.providerKind ?? null,
    "VIDEO_DIAGNOSTIC_NOT_CONFIGURED"
  );

  if (request.mode === "CONFIG") {
    return diagnosticResult(
      inspection.configured ? "CONFIG_VALID" : "NOT_CONFIGURED",
      inspection.configured ? "CONFIG_VALID" : configCode,
      request.providerKind ?? null,
      null,
      checkedAt,
      []
    );
  }

  const providerKind = request.providerKind;
  if (!inspection.configured) {
    const diagnostic = diagnosticResult(
      "NOT_CONFIGURED",
      configCode,
      providerKind,
      null,
      checkedAt,
      []
    );
    await persistAudit(deps, actorId, diagnostic, checkedAt);
    return diagnostic;
  }

  const operations = paidOperations(providerKind);
  let diagnostic: DigitalHumanVideoDiagnosticResult;
  try {
    const assets = await deps.prepareAssets(
      providerKind,
      actorId,
      inspection.requiresPortrait
    );
    const audioUrl = await deps.createReadUrl(assets.audio);
    let portraitUrl: string | null = null;
    let portraitMetadata: VideoAssetMetadata | null = null;
    if (inspection.requiresPortrait) {
      if (!assets.portrait) {
        throw new MediaConfigurationError("A diagnostic portrait is required", {
          code: providerKind === "ALIBABA_EMO"
            ? "EMO_PORTRAIT_NOT_CONFIGURED"
            : "LINGMOU_PORTRAIT_NOT_CONFIGURED"
        });
      }
      portraitUrl = await deps.createReadUrl(assets.portrait);
      portraitMetadata = assets.portrait.metadata;
    }
    const submitInput: VideoSubmitInput = {
      requestName: `diagnostic-${checkedAt.getTime()}`,
      audioUrl,
      portraitUrl,
      audioMetadata: assets.audio.metadata,
      portraitMetadata
    };
    const submission = providerKind === "LINGMOU_BROADCAST"
      ? await deps.submitLingmou(submitInput)
      : await deps.submitEmo(submitInput);
    diagnostic = diagnosticResult(
      "REACHABLE",
      "REACHABLE",
      providerKind,
      safeTraceId(submission.traceId),
      checkedAt,
      operations
    );
  } catch (error) {
    diagnostic = diagnosticResult(
      "PROVIDER_ERROR",
      safeProviderCode(error, providerKind),
      providerKind,
      safeErrorTraceId(error),
      checkedAt,
      operations
    );
  }

  // Audit durability is part of the paid operation contract. A write failure
  // propagates so the route cannot claim a successfully audited diagnostic.
  await persistAudit(deps, actorId, diagnostic, checkedAt);
  return diagnostic;
}

function diagnosticResult(
  status: DigitalHumanVideoDiagnosticStatus,
  code: string,
  providerKind: VideoProviderKind | null,
  traceId: string | null,
  checkedAt: Date,
  billingOperations: DigitalHumanVideoBillingOperation[]
): DigitalHumanVideoDiagnosticResult {
  return {
    status,
    code,
    providerKind,
    traceId,
    checkedAt: checkedAt.toISOString(),
    billingOperations,
    costSemantics: billingOperations.length === 0
      ? "NO_PAID_OPERATION"
      : "POTENTIALLY_BILLABLE_OPERATIONS_COST_NOT_ESTIMATED"
  };
}

async function persistAudit(
  deps: DigitalHumanVideoDiagnosticDependencies,
  actorId: string,
  diagnostic: DigitalHumanVideoDiagnosticResult,
  checkedAt: Date
) {
  if (!diagnostic.providerKind) return;
  await deps.saveAudit({
    actorId,
    providerKind: diagnostic.providerKind,
    status: diagnostic.status,
    safeCode: diagnostic.code,
    traceId: diagnostic.traceId,
    checkedAt,
    billingOperations: diagnostic.billingOperations,
    costSemantics: diagnostic.costSemantics
  });
}

function paidOperations(providerKind: VideoProviderKind): DigitalHumanVideoBillingOperation[] {
  return providerKind === "LINGMOU_BROADCAST"
    ? ["ALIBABA_TTS_SYNTHESIS", "LINGMOU_BROADCAST_SUBMISSION"]
    : [
      "ALIBABA_TTS_SYNTHESIS",
      "ALIBABA_EMO_FACE_DETECTION",
      "ALIBABA_EMO_VIDEO_SYNTHESIS"
    ];
}

function providerFallback(providerKind: VideoProviderKind) {
  return providerKind === "ALIBABA_EMO"
    ? "ALIBABA_EMO_DIAGNOSTIC_FAILED"
    : "LINGMOU_BROADCAST_DIAGNOSTIC_FAILED";
}

function safeProviderCode(error: unknown, providerKind: VideoProviderKind) {
  const fallback = providerFallback(providerKind);
  const value = error instanceof MediaProviderError || error instanceof MediaConfigurationError
    ? error.code
    : null;
  return sanitizeCode(value, providerKind, fallback);
}

function safeErrorTraceId(error: unknown) {
  return error instanceof MediaProviderError ? safeTraceId(error.traceId) : null;
}

function sanitizeCode(
  value: unknown,
  providerKind: VideoProviderKind | null,
  fallback: string
) {
  if (typeof value !== "string") return fallback;
  if (commonCodeAllowlist.has(value)) return value;
  return providerKind && providerCodeAllowlists[providerKind].has(value)
    ? value
    : fallback;
}

function safeTraceId(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function safeActorId(value: string) {
  return /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}

export function sanitizeDigitalHumanVideoDiagnosticResult(
  value: DigitalHumanVideoDiagnosticResult
): DigitalHumanVideoDiagnosticResult {
  const providerKind = value.providerKind === "LINGMOU_BROADCAST" || value.providerKind === "ALIBABA_EMO"
    ? value.providerKind
    : null;
  const status = statusAllowlist.has(value.status) ? value.status : "PROVIDER_ERROR";
  const fallback = providerKind ? providerFallback(providerKind) : "VIDEO_DIAGNOSTIC_NOT_CONFIGURED";
  const checkedAt = typeof value.checkedAt === "string" && !Number.isNaN(Date.parse(value.checkedAt))
    ? new Date(value.checkedAt).toISOString()
    : new Date(0).toISOString();
  const billingOperations = Array.isArray(value.billingOperations)
    ? value.billingOperations.filter((operation): operation is DigitalHumanVideoBillingOperation =>
      billingOperationAllowlist.has(operation)
    )
    : [];
  return {
    status,
    code: sanitizeCode(value.code, providerKind, fallback),
    providerKind,
    traceId: safeTraceId(value.traceId),
    checkedAt,
    billingOperations,
    costSemantics: billingOperations.length === 0
      ? "NO_PAID_OPERATION"
      : "POTENTIALLY_BILLABLE_OPERATIONS_COST_NOT_ESTIMATED"
  };
}

export type DiagnosticProfileRecord = {
  id: string;
  voice: string;
  styleJson: string;
  portraitAssetId: string | null;
  lingmouMappingJson: string;
  emoMappingJson: string;
  providerRole: string;
  enabled: boolean;
};

export type DiagnosticAssetRecord = {
  id: string;
  storageConfigId: string;
  mimeType: string;
  byteLength: number;
  purpose: string;
  cleanupStatus: string;
  expiresAt: Date | null;
};

export interface DigitalHumanVideoConfigurationDependencies {
  loadRuntimeSettings: () => Promise<DigitalHumanVideoRuntimeSettings>;
  resolveTtsModel: () => Promise<ResolvedMediaModel>;
  resolveVideoModel: (id: string) => Promise<ResolvedMediaModel>;
  findProfile: (id: string) => Promise<DiagnosticProfileRecord | null>;
  findAsset: (id: string) => Promise<DiagnosticAssetRecord | null>;
  findStorage: (id: string) => Promise<MediaStorageConfigRecord | null>;
  findDefaultStorage: () => Promise<MediaStorageConfigRecord | null>;
  readConfigSecret: () => string;
  now: () => Date;
  externalBoundary?: (name: string) => Promise<void>;
}

export async function inspectDigitalHumanVideoConfiguration(
  providerKind?: VideoProviderKind,
  dependencyOverrides: Partial<DigitalHumanVideoConfigurationDependencies> = {}
): Promise<ConfigurationInspection> {
  const deps: DigitalHumanVideoConfigurationDependencies = {
    loadRuntimeSettings: loadDefaultRuntimeSettings,
    resolveTtsModel: () => resolveMediaModel("TEXT_TO_SPEECH"),
    resolveVideoModel: (id) => resolveMediaModelById(id, "DIGITAL_HUMAN_VIDEO"),
    findProfile: (id) => prisma.interviewerAvatarProfile.findUnique({ where: { id } }),
    findAsset: (id) => prisma.digitalHumanMediaAsset.findUnique({ where: { id } }),
    findStorage: (id) => prisma.mediaStorageConfig.findUnique({ where: { id } }),
    findDefaultStorage: () => prisma.mediaStorageConfig.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    }),
    readConfigSecret: readAiConfigSecret,
    now: () => new Date(),
    ...dependencyOverrides
  };

  try {
    const settings = await deps.loadRuntimeSettings();
    const providers = providersForInspection(settings, providerKind);
    const [ttsModel, defaultStorage] = await Promise.all([
      deps.resolveTtsModel(),
      deps.findDefaultStorage()
    ]);
    validateAlibabaTtsConfiguration(ttsModel, deps.readConfigSecret);
    validateStorage(defaultStorage, deps.readConfigSecret);

    let requiresPortrait = false;
    for (const selectedProvider of providers) {
      const profileId = profileIdFor(settings, selectedProvider);
      const profile = await deps.findProfile(profileId);
      validateProfileBase(profile, profileId);
      parseVideoSpeechProfileStyle(profile.styleJson);

      const modelId = selectedProvider === "LINGMOU_BROADCAST"
        ? settings.lingmouModelId
        : settings.emoModelId;
      const model = await deps.resolveVideoModel(modelId);
      if (selectedProvider === "LINGMOU_BROADCAST") {
        const config = resolveLingmouBroadcastConfiguration(model, deps.readConfigSecret);
        validateLingmouMapping(profile.lingmouMappingJson, config);
        if (config.portraitVariableName) {
          requiresPortrait = true;
          await validatePortrait(profile, null, deps);
        }
      } else {
        resolveAlibabaEmoConfiguration(model, deps.readConfigSecret);
        const mapping = parseEmoMapping(profile.emoMappingJson);
        requiresPortrait = true;
        await validatePortrait(profile, mapping, deps);
      }
    }
    return {
      configured: true,
      safeCode: "CONFIG_VALID",
      requiresPortrait,
      validatedProviders: providers
    };
  } catch (error) {
    const requested = providerKind ?? null;
    return {
      configured: false,
      safeCode: sanitizeCode(
        error instanceof MediaConfigurationError || error instanceof VideoConfigurationError
          ? error.code
          : null,
        requested,
        "VIDEO_DIAGNOSTIC_NOT_CONFIGURED"
      ),
      requiresPortrait: requested === "ALIBABA_EMO",
      validatedProviders: []
    };
  }
}

class VideoConfigurationError extends Error {
  constructor(readonly code: string) {
    super("Digital human video configuration is invalid");
  }
}

function providersForInspection(
  settings: DigitalHumanVideoRuntimeSettings,
  requested?: VideoProviderKind
): VideoProviderKind[] {
  if (requested) return [requested];
  if (settings.mode === "LINGMOU_ONLY") return ["LINGMOU_BROADCAST"];
  if (settings.mode === "EMO_ONLY") return ["ALIBABA_EMO"];
  return ["LINGMOU_BROADCAST", "ALIBABA_EMO"];
}

function profileIdFor(settings: DigitalHumanVideoRuntimeSettings, provider: VideoProviderKind) {
  const id = provider === "ALIBABA_EMO" && !settings.synchronizeProfiles
    ? settings.secondaryProfileId
    : settings.primaryProfileId;
  if (!id) throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  return id;
}

function validateProfileBase(
  profile: DiagnosticProfileRecord | null,
  expectedId: string
): asserts profile is DiagnosticProfileRecord {
  if (
    !profile ||
    !profile.enabled ||
    profile.id !== expectedId ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(profile.voice.trim()) ||
    !/^[A-Z0-9_]{1,64}$/.test(profile.providerRole.trim().toUpperCase())
  ) {
    throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  }
}

function validateLingmouMapping(
  value: string,
  config: ReturnType<typeof resolveLingmouBroadcastConfiguration>
) {
  const mapping = parseStrictObject(value, [
    "templateId",
    "audioVariableName",
    "portraitVariableName"
  ]);
  if (
    mapping.templateId !== config.templateId ||
    mapping.audioVariableName !== config.audioVariableName ||
    mapping.portraitVariableName !== config.portraitVariableName
  ) {
    throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  }
}

function parseEmoMapping(value: string) {
  const mapping = parseStrictObject(value, ["portraitWidth", "portraitHeight"]);
  if (!validPortraitDimension(mapping.portraitWidth) || !validPortraitDimension(mapping.portraitHeight)) {
    throw new VideoConfigurationError("EMO_PORTRAIT_NOT_CONFIGURED");
  }
  return { width: mapping.portraitWidth, height: mapping.portraitHeight };
}

async function validatePortrait(
  profile: DiagnosticProfileRecord,
  dimensions: { width: number; height: number } | null,
  deps: DigitalHumanVideoConfigurationDependencies
) {
  if (!profile.portraitAssetId) {
    throw new VideoConfigurationError(
      dimensions ? "EMO_PORTRAIT_NOT_CONFIGURED" : "LINGMOU_PORTRAIT_NOT_CONFIGURED"
    );
  }
  const asset = await deps.findAsset(profile.portraitAssetId);
  const contentType = asset?.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (
    !asset ||
    asset.purpose !== "PORTRAIT" ||
    asset.cleanupStatus !== "ACTIVE" ||
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength <= 0 ||
    (asset.expiresAt !== null && asset.expiresAt.getTime() <= deps.now().getTime()) ||
    !["image/jpeg", "image/png", "image/bmp", "image/x-ms-bmp", "image/webp"].includes(contentType ?? "")
  ) {
    throw new VideoConfigurationError("VIDEO_DIAGNOSTIC_PORTRAIT_INVALID");
  }
  if (dimensions && (
    !validPortraitDimension(dimensions.width) || !validPortraitDimension(dimensions.height)
  )) {
    throw new VideoConfigurationError("EMO_PORTRAIT_NOT_CONFIGURED");
  }
  const storage = await deps.findStorage(asset.storageConfigId);
  validateStorage(storage, deps.readConfigSecret);
}

function validateStorage(
  storage: MediaStorageConfigRecord | null,
  readConfigSecret: () => string
) {
  if (
    !storage ||
    !storage.enabled ||
    storage.providerKind !== "ALI_OSS" ||
    !/^[A-Za-z0-9.-]{3,255}$/.test(storage.endpoint.trim()) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(storage.bucket.trim()) ||
    !storage.credentialsCiphertext ||
    !storage.credentialsIv ||
    !storage.credentialsTag
  ) {
    throw new VideoConfigurationError("VIDEO_DIAGNOSTIC_STORAGE_NOT_CONFIGURED");
  }
  try {
    decryptOssCredentials({
      ciphertext: storage.credentialsCiphertext,
      iv: storage.credentialsIv,
      tag: storage.credentialsTag
    }, readConfigSecret());
  } catch {
    throw new VideoConfigurationError("VIDEO_DIAGNOSTIC_STORAGE_NOT_CONFIGURED");
  }
}

function parseStrictObject(value: string, keys: string[]): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  }
  return record;
}

function validPortraitDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 400 && value <= 7000;
}

async function inspectDefaultConfiguration(providerKind?: VideoProviderKind) {
  return inspectDigitalHumanVideoConfiguration(providerKind);
}

async function prepareDefaultAssets(
  providerKind: VideoProviderKind,
  actorId: string,
  requiresPortrait: boolean
) {
  const context = await loadRuntimeContext(providerKind);
  const speech = await createVideoSpeechAsset({
    sessionId: `diagnostic-${actorId}`,
    questionId: "diagnostic-connectivity",
    question: "这是一次数字人连通性测试。",
    stage: "WARM_UP",
    interviewerProfileId: context.profile.id,
    behaviorSignals: { diagnostic: true }
  });
  const audio = await prisma.digitalHumanMediaAsset.findUnique({ where: { id: speech.assetId } });
  if (!audio) {
    throw new MediaConfigurationError("Diagnostic audio asset is unavailable", {
      code: "VIDEO_DIAGNOSTIC_AUDIO_UNAVAILABLE"
    });
  }
  const portrait = requiresPortrait && context.profile.portraitAssetId
    ? await prisma.digitalHumanMediaAsset.findUnique({ where: { id: context.profile.portraitAssetId } })
    : null;
  const emoMapping = providerKind === "ALIBABA_EMO"
    ? parseEmoMapping(context.profile.emoMappingJson)
    : null;
  return {
    audio: {
      objectKey: audio.objectKey,
      storageConfigId: audio.storageConfigId,
      metadata: {
        contentType: audio.mimeType,
        byteLength: audio.byteLength,
        durationSeconds: Math.max(0.01, (audio.byteLength - 44) / (48_000 * 2))
      }
    },
    portrait: portrait ? {
      objectKey: portrait.objectKey,
      storageConfigId: portrait.storageConfigId,
      metadata: {
        contentType: portrait.mimeType,
        byteLength: portrait.byteLength,
        ...(emoMapping ? { width: emoMapping.width, height: emoMapping.height } : {})
      }
    } : null
  };
}

async function createDefaultReadUrl(asset: DiagnosticInternalAsset) {
  if (!asset.storageConfigId) {
    throw new MediaConfigurationError("Diagnostic storage is unavailable", {
      code: "VIDEO_DIAGNOSTIC_STORAGE_UNAVAILABLE"
    });
  }
  const config = await prisma.mediaStorageConfig.findUnique({ where: { id: asset.storageConfigId } });
  if (!config || !config.enabled) {
    throw new MediaConfigurationError("Diagnostic storage is unavailable", {
      code: "VIDEO_DIAGNOSTIC_STORAGE_UNAVAILABLE"
    });
  }
  return createStorage(config).createReadUrl(asset.objectKey, 300);
}

async function submitDefaultLingmou(input: VideoSubmitInput) {
  const context = await loadRuntimeContext("LINGMOU_BROADCAST");
  const model = await resolveMediaModelById(context.settings.lingmouModelId, "DIGITAL_HUMAN_VIDEO");
  return createLingmouBroadcastProvider(model).submit(input);
}

async function submitDefaultEmo(input: VideoSubmitInput) {
  const context = await loadRuntimeContext("ALIBABA_EMO");
  const model = await resolveMediaModelById(context.settings.emoModelId, "DIGITAL_HUMAN_VIDEO");
  return createAlibabaEmoProvider(model).submit(input);
}

async function saveDefaultAudit(audit: DiagnosticAuditRecord) {
  await prisma.digitalHumanVideoDiagnosticAudit.create({
    data: {
      actorId: audit.actorId,
      providerKind: audit.providerKind,
      status: audit.status,
      safeCode: audit.safeCode,
      traceId: audit.traceId,
      checkedAt: audit.checkedAt,
      billingOperationsJson: JSON.stringify(audit.billingOperations),
      costSemantics: audit.costSemantics
    }
  });
}

async function loadDefaultRuntimeSettings() {
  const row = await prisma.aiRuntimeSetting.findUnique({
    where: { key: digitalHumanVideoRuntimeSettingKey }
  });
  if (!row) throw new VideoConfigurationError("VIDEO_DIAGNOSTIC_NOT_CONFIGURED");
  return parseDigitalHumanVideoRuntimeSettings(row.valueJson);
}

async function loadRuntimeContext(providerKind: VideoProviderKind) {
  const settings = await loadDefaultRuntimeSettings();
  const profileId = profileIdFor(settings, providerKind);
  const profile = await prisma.interviewerAvatarProfile.findUnique({ where: { id: profileId } });
  if (!profile?.enabled) throw new VideoConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  return { settings, profile, providerKind };
}

function createStorage(config: Parameters<typeof createOssPrivateMediaStorage>[0]): PrivateMediaStorage {
  if (config.providerKind !== "ALI_OSS" || !config.endpoint.trim() || !config.bucket.trim()) {
    throw new VideoConfigurationError("VIDEO_DIAGNOSTIC_STORAGE_NOT_CONFIGURED");
  }
  return createOssPrivateMediaStorage(config, readAiConfigSecret());
}

import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { resolveMediaModel, resolveMediaModelById } from "@/lib/media/config";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import { createAlibabaTtsProvider } from "@/lib/media/providers/alibabaTts";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import type { PrivateMediaStorage } from "@/lib/media/storage/types";
import { createVideoSpeechAsset } from "@/lib/media/video/speechAsset";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";
import type {
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

export type DigitalHumanVideoDiagnosticRequest =
  | {
    mode: "CONFIG";
    providerKind?: VideoProviderKind;
  }
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
};

export interface DigitalHumanVideoDiagnosticDependencies {
  inspectConfiguration: (
    providerKind?: VideoProviderKind
  ) => Promise<{ configured: boolean; safeCode: string }>;
  prepareAssets: (
    providerKind: VideoProviderKind,
    actorId: string
  ) => Promise<{
    audio: DiagnosticInternalAsset;
    portrait: DiagnosticInternalAsset | null;
  }>;
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
  const requestedProviderKind = request.providerKind;
  const checkedAt = deps.now();
  let inspection: { configured: boolean; safeCode: string };
  try {
    inspection = await deps.inspectConfiguration(requestedProviderKind);
  } catch {
    inspection = { configured: false, safeCode: "VIDEO_DIAGNOSTIC_NOT_CONFIGURED" };
  }
  const configCode = safeCode(inspection.safeCode, "VIDEO_DIAGNOSTIC_NOT_CONFIGURED");

  if (request.mode === "CONFIG") {
    return result(
      inspection.configured ? "CONFIG_VALID" : "NOT_CONFIGURED",
      inspection.configured ? "CONFIG_VALID" : configCode,
      requestedProviderKind ?? null,
      null,
      checkedAt
    );
  }

  const providerKind = request.providerKind;

  if (!inspection.configured) {
    const diagnostic = result(
      "NOT_CONFIGURED",
      configCode,
      providerKind ?? null,
      null,
      checkedAt
    );
    await persistAudit(deps, actorId, diagnostic, checkedAt);
    return diagnostic;
  }

  try {
    const assets = await deps.prepareAssets(providerKind, actorId);
    const audioUrl = await deps.createReadUrl(assets.audio);
    const portraitUrl = assets.portrait
      ? await deps.createReadUrl(assets.portrait)
      : null;
    const submitInput: VideoSubmitInput = {
      requestName: `diagnostic-${checkedAt.getTime()}`,
      audioUrl,
      portraitUrl,
      audioMetadata: assets.audio.metadata,
      portraitMetadata: assets.portrait?.metadata ?? null
    };
    const submission = providerKind === "LINGMOU_BROADCAST"
      ? await deps.submitLingmou(submitInput)
      : await deps.submitEmo(submitInput);
    const diagnostic = result(
      "REACHABLE",
      "REACHABLE",
      providerKind,
      safeTraceId(submission.traceId),
      checkedAt
    );
    await persistAudit(deps, actorId, diagnostic, checkedAt);
    return diagnostic;
  } catch (error) {
    const diagnostic = result(
      "PROVIDER_ERROR",
      safeProviderCode(error, providerKind),
      providerKind,
      safeErrorTraceId(error),
      checkedAt
    );
    await persistAudit(deps, actorId, diagnostic, checkedAt);
    return diagnostic;
  }
}

function result(
  status: DigitalHumanVideoDiagnosticStatus,
  code: string,
  providerKind: VideoProviderKind | null,
  traceId: string | null,
  checkedAt: Date
): DigitalHumanVideoDiagnosticResult {
  return { status, code, providerKind, traceId, checkedAt: checkedAt.toISOString() };
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
    checkedAt
  }).catch(() => undefined);
}

function safeProviderCode(error: unknown, providerKind: VideoProviderKind) {
  const fallback = providerKind === "ALIBABA_EMO"
    ? "ALIBABA_EMO_DIAGNOSTIC_FAILED"
    : "LINGMOU_BROADCAST_DIAGNOSTIC_FAILED";
  return error instanceof MediaProviderError || error instanceof MediaConfigurationError
    ? safeCode(error.code, fallback)
    : fallback;
}

function safeErrorTraceId(error: unknown) {
  return error instanceof MediaProviderError ? safeTraceId(error.traceId) : null;
}

function safeCode(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Z0-9_.-]{1,100}$/.test(value)
    ? value
    : fallback;
}

function safeTraceId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)
    ? value
    : null;
}

function safeActorId(value: string) {
  return /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}

async function inspectDefaultConfiguration(providerKind?: VideoProviderKind) {
  try {
    const context = await loadRuntimeContext(providerKind);
    const ttsModel = await resolveMediaModel("TEXT_TO_SPEECH");
    await createAlibabaTtsProvider(ttsModel).checkConnection();
    createStorage(context.storage);
    parseObject(context.profile.styleJson);
    if (context.providerKind === "LINGMOU_BROADCAST") {
      parseObject(context.profile.lingmouMappingJson);
      const model = await resolveMediaModelById(
        context.settings.lingmouModelId,
        "DIGITAL_HUMAN_VIDEO"
      );
      const config = resolveLingmouBroadcastConfiguration(model);
      if (config.portraitVariableName && !context.profile.portraitAssetId) {
        return { configured: false, safeCode: "LINGMOU_PORTRAIT_NOT_CONFIGURED" };
      }
    } else {
      const mapping = parseObject(context.profile.emoMappingJson);
      if (
        !context.profile.portraitAssetId ||
        !positiveInteger(mapping.portraitWidth) ||
        !positiveInteger(mapping.portraitHeight)
      ) {
        return { configured: false, safeCode: "EMO_PORTRAIT_NOT_CONFIGURED" };
      }
      const model = await resolveMediaModelById(
        context.settings.emoModelId,
        "DIGITAL_HUMAN_VIDEO"
      );
      resolveAlibabaEmoConfiguration(model);
    }
    return { configured: true, safeCode: "CONFIG_VALID" };
  } catch (error) {
    return {
      configured: false,
      safeCode: error instanceof MediaConfigurationError
        ? safeCode(error.code, "VIDEO_DIAGNOSTIC_NOT_CONFIGURED")
        : "VIDEO_DIAGNOSTIC_NOT_CONFIGURED"
    };
  }
}

async function prepareDefaultAssets(providerKind: VideoProviderKind, actorId: string) {
  const context = await loadRuntimeContext(providerKind);
  const speech = await createVideoSpeechAsset({
    sessionId: `diagnostic-${actorId}`,
    questionId: "diagnostic-connectivity",
    question: "这是一次数字人连通性测试。",
    stage: "WARM_UP",
    interviewerProfileId: context.profile.id,
    behaviorSignals: { diagnostic: true }
  });
  const audio = await prisma.digitalHumanMediaAsset.findUnique({
    where: { id: speech.assetId }
  });
  if (!audio) throw new MediaConfigurationError("Diagnostic audio asset is unavailable", {
    code: "VIDEO_DIAGNOSTIC_AUDIO_UNAVAILABLE"
  });
  const portrait = context.profile.portraitAssetId
    ? await prisma.digitalHumanMediaAsset.findUnique({
      where: { id: context.profile.portraitAssetId }
    })
    : null;
  const emoMapping = parseObject(context.profile.emoMappingJson);
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
        ...(positiveInteger(emoMapping.portraitWidth)
          ? { width: emoMapping.portraitWidth }
          : {}),
        ...(positiveInteger(emoMapping.portraitHeight)
          ? { height: emoMapping.portraitHeight }
          : {})
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
  const config = await prisma.mediaStorageConfig.findUnique({
    where: { id: asset.storageConfigId }
  });
  if (!config || !config.enabled) {
    throw new MediaConfigurationError("Diagnostic storage is unavailable", {
      code: "VIDEO_DIAGNOSTIC_STORAGE_UNAVAILABLE"
    });
  }
  return createStorage(config).createReadUrl(asset.objectKey, 300);
}

async function submitDefaultLingmou(input: VideoSubmitInput) {
  const context = await loadRuntimeContext("LINGMOU_BROADCAST");
  const model = await resolveMediaModelById(
    context.settings.lingmouModelId,
    "DIGITAL_HUMAN_VIDEO"
  );
  return createLingmouBroadcastProvider(model).submit(input);
}

async function submitDefaultEmo(input: VideoSubmitInput) {
  const context = await loadRuntimeContext("ALIBABA_EMO");
  const model = await resolveMediaModelById(
    context.settings.emoModelId,
    "DIGITAL_HUMAN_VIDEO"
  );
  return createAlibabaEmoProvider(model).submit(input);
}

async function saveDefaultAudit(audit: DiagnosticAuditRecord) {
  await prisma.aiCallLog.create({
    data: {
      capability: "DIGITAL_HUMAN_VIDEO_DIAGNOSTIC",
      provider: audit.providerKind,
      latencyMs: 0,
      costEstimate: 0,
      success: audit.status === "REACHABLE",
      failureReason: audit.safeCode,
      fallbackProvider: `admin:${audit.actorId}`
    }
  });
}

async function loadRuntimeContext(providerKind?: VideoProviderKind) {
  const row = await prisma.aiRuntimeSetting.findUnique({
    where: { key: digitalHumanVideoRuntimeSettingKey }
  });
  if (!row) throw new Error("runtime settings missing");
  const settings = parseDigitalHumanVideoRuntimeSettings(row.valueJson);
  const resolvedProviderKind = providerKind ?? (
    settings.mode === "EMO_ONLY" ? "ALIBABA_EMO" : "LINGMOU_BROADCAST"
  );
  const profileId = resolvedProviderKind === "ALIBABA_EMO" && !settings.synchronizeProfiles
    ? settings.secondaryProfileId
    : settings.primaryProfileId;
  if (!profileId) throw new Error("profile missing");
  const [profile, storage] = await Promise.all([
    prisma.interviewerAvatarProfile.findUnique({ where: { id: profileId } }),
    prisma.mediaStorageConfig.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    })
  ]);
  if (!profile?.enabled || !storage?.enabled) throw new Error("configuration missing");
  return { settings, profile, storage, providerKind: resolvedProviderKind };
}

function createStorage(config: Parameters<typeof createOssPrivateMediaStorage>[0]): PrivateMediaStorage {
  if (config.providerKind !== "ALI_OSS" || !config.endpoint.trim() || !config.bucket.trim()) {
    throw new Error("storage invalid");
  }
  return createOssPrivateMediaStorage(config, readAiConfigSecret());
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid mapping");
  }
  return parsed as Record<string, unknown>;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

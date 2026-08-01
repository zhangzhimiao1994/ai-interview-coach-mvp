import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret, readAiConfigSecret } from "@/lib/domain/aiServices";
import { prisma } from "@/lib/db/prisma";
import { resolveMediaModelById } from "@/lib/media/config";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import { createAlibabaEmoProvider } from "./providers/alibabaEmo";
import { createLingmouBroadcastProvider, resolveLingmouBroadcastConfiguration } from "./providers/lingmouBroadcast";
import {
  createPrismaRenderRepository,
  type RenderAttemptDefinition,
  type RenderJobKind,
  type RenderRepository,
  type RenderSnapshot
} from "./renderRepository";
import { cacheProviderVideoOutput } from "./renderCache";
import { getDueProviders } from "./renderSchedule";
export { chooseVideoRenderWinner } from "./renderWinner";
import type {
  AsyncAvatarVideoProvider,
  DigitalHumanVideoRuntimeSettings,
  VideoAssetMetadata,
  VideoProviderKind
} from "./types";

export type EnsureRenderInput = {
  trainingSessionId: string;
  questionId: string;
  questionHash: string;
  cacheKey: string;
  kind: RenderJobKind;
  audioAssetId: string;
  createdAt: Date;
  deadlineAt: Date;
  runtimeSettings: DigitalHumanVideoRuntimeSettings;
};

type RenderProfile = {
  id: string;
  displayName: string;
  portraitAssetId: string | null;
  enabled: boolean;
  emoMappingJson?: string;
  lingmouMappingJson?: string;
};

type InternalRenderAsset = {
  id: string;
  storageConfigId: string;
  objectKey: string;
  mimeType: string;
  byteLength: number;
  purpose: string;
  expiresAt: Date | null;
  cleanupStatus: string;
};

type ResolvedVideoProvider = {
  modelId: string;
  providerId: string;
  provider: AsyncAvatarVideoProvider;
  requiresPortrait: boolean;
  validateProfile?(profile: RenderProfile): void;
};

type OutputEnvelope = { ciphertext: string; iv: string; tag: string };

export interface RenderOrchestrator {
  ensurePresetJob(input: EnsureRenderInput): Promise<RenderSnapshot>;
  startDynamicRace(input: EnsureRenderInput): Promise<RenderSnapshot>;
  advance(renderJobId: string, observedAt: Date): Promise<RenderSnapshot>;
  collectLateResults(renderJobId: string, observedAt: Date): Promise<void>;
}

export interface RenderOrchestratorDependencies {
  repository: RenderRepository;
  resolveProfile(id: string): Promise<RenderProfile | null>;
  resolveVideoModel(id: string, providerKind: VideoProviderKind): Promise<ResolvedVideoProvider>;
  loadAsset(id: string): Promise<InternalRenderAsset | null>;
  createReadUrl(asset: InternalRenderAsset): Promise<string>;
  cacheOutput(input: { attemptId: string; videoUrl: string; observedAt: Date }): Promise<{
    assetId: string;
    objectKey?: string;
    created?: boolean;
  }>;
  encryptOutputUrl(url: string): OutputEnvelope;
  decryptOutputUrl(envelope: OutputEnvelope): string;
}

export function createRenderOrchestrator(
  dependencyOverrides: Partial<RenderOrchestratorDependencies> = {}
): RenderOrchestrator {
  const deps: RenderOrchestratorDependencies = {
    repository: createPrismaRenderRepository(),
    resolveProfile: defaultResolveProfile,
    resolveVideoModel: defaultResolveVideoModel,
    loadAsset: defaultLoadAsset,
    createReadUrl: defaultCreateReadUrl,
    cacheOutput: ({ attemptId, videoUrl, observedAt }) => cacheProviderVideoOutput({ attemptId, videoUrl, observedAt }),
    encryptOutputUrl: (url) => encryptSecret(url, readAiConfigSecret()),
    decryptOutputUrl: (envelope) => decryptSecret(envelope, readAiConfigSecret()),
    ...dependencyOverrides
  };

  async function ensure(input: EnsureRenderInput, expectedKind: RenderJobKind) {
    validateRenderInput(input, expectedKind);
    const prepared = await prepare(input, deps);
    const planFingerprint = renderPlanFingerprint(input, prepared.definitions);
    const snapshot = await deps.repository.ensureJob({
      trainingSessionId: input.trainingSessionId,
      questionId: input.questionId,
      questionHash: input.questionHash,
      cacheKey: input.cacheKey,
      kind: expectedKind,
      mode: input.runtimeSettings.mode,
      interviewerProfileId: input.runtimeSettings.primaryProfileId,
      audioAssetId: input.audioAssetId,
      createdAt: input.createdAt,
      deadlineAt: input.deadlineAt,
      planFingerprint,
      attempts: prepared.definitions
    });
    const context = await deps.repository.loadContext(snapshot.id);
    if (!context) throw new Error("VIDEO_RENDER_NOT_FOUND");
    const persistedSettings = settingsFromPersisted(context);
    const submitProviders = new Set(initialSubmitProviders(
      context.job.kind as RenderJobKind,
      context.job.mode as DigitalHumanVideoRuntimeSettings["mode"]
    ));
    await Promise.all(context.attempts
      .filter((attempt) => submitProviders.has(attempt.providerKind as VideoProviderKind))
      .map((attempt) =>
      submitAttempt(attempt.id, context.job.createdAt, persistedSettings, deps)
    ));
    await deps.repository.refreshActiveStatus(snapshot.id);
    return (await deps.repository.getSnapshot(snapshot.id))!;
  }

  return {
    ensurePresetJob: (input) => ensure(input, "PRESET"),
    startDynamicRace: (input) => ensure(input, "DYNAMIC"),

    async advance(renderJobId, observedAt) {
      await deps.repository.expireSubmissionClaims(renderJobId, observedAt);
      await advanceQueries(renderJobId, observedAt, deps, false);
      await cachePending(renderJobId, observedAt, deps);
      await ensurePresetFailureFallback(renderJobId, observedAt, deps);
      await deps.repository.chooseWinner(renderJobId, observedAt);
      await deps.repository.finalizeFallback(renderJobId, observedAt, "VIDEO_RENDER_DEADLINE_EXCEEDED");
      const snapshot = await deps.repository.getSnapshot(renderJobId);
      if (!snapshot) throw new Error("VIDEO_RENDER_NOT_FOUND");
      return snapshot;
    },

    async collectLateResults(renderJobId, observedAt) {
      await advanceQueries(renderJobId, observedAt, deps, true);
      await cachePending(renderJobId, observedAt, deps);
    }
  };
}

async function prepare(input: EnsureRenderInput, deps: RenderOrchestratorDependencies) {
  const audio = await deps.loadAsset(input.audioAssetId);
  validateAsset(audio, "TTS_AUDIO", input.createdAt);
  const providers = configuredProviders(input.runtimeSettings.mode);
  const definitions: RenderAttemptDefinition[] = [];
  for (const providerKind of providers) {
    const profileId = profileIdFor(input.runtimeSettings, providerKind);
    const profile = await deps.resolveProfile(profileId);
    validateProfile(profile, profileId);
    const resolved = await deps.resolveVideoModel(modelIdFor(input.runtimeSettings, providerKind), providerKind);
    resolved.validateProfile?.(profile);
    const portrait = profile.portraitAssetId
      ? await deps.loadAsset(profile.portraitAssetId)
      : null;
    if (resolved.requiresPortrait) validateAsset(portrait, "PORTRAIT", input.createdAt);
    definitions.push({
      providerKind,
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      interviewerProfileId: profile.id,
      interviewerName: profile.displayName,
      portraitAssetId: resolved.requiresPortrait ? profile.portraitAssetId : null
    });
  }
  return { definitions };
}

async function submitAttempt(
  attemptId: string,
  observedAt: Date,
  settings: DigitalHumanVideoRuntimeSettings,
  deps: RenderOrchestratorDependencies
) {
  const claim = await deps.repository.claimSubmission(attemptId, observedAt);
  if (!claim) return;
  const context = await loadAttemptContext(claim.renderJobId, attemptId, deps);
  if (!context) return;
  let providerCallStarted = false;
  try {
    const audio = await deps.loadAsset(context.job.audioAssetId!);
    validateAsset(audio, "TTS_AUDIO", observedAt);
    const profile = await deps.resolveProfile(context.attempt.interviewerProfileId!);
    validateProfile(profile, context.attempt.interviewerProfileId!);
    const resolved = await deps.resolveVideoModel(context.attempt.modelId, context.attempt.providerKind as VideoProviderKind);
    if (resolved.providerId !== context.attempt.providerId) throw new RenderConfigurationError("VIDEO_MODEL_STALE");
    resolved.validateProfile?.(profile);
    const portrait = context.attempt.portraitAssetId
      ? await deps.loadAsset(context.attempt.portraitAssetId)
      : null;
    if (resolved.requiresPortrait) validateAsset(portrait, "PORTRAIT", observedAt);
    const audioUrl = await deps.createReadUrl(audio!);
    const portraitUrl = portrait ? await deps.createReadUrl(portrait) : null;
    providerCallStarted = true;
    const submission = await resolved.provider.submit({
      requestName: `render-${context.job.id}-${context.attempt.providerKind}`,
      audioUrl,
      portraitUrl,
      audioMetadata: audioMetadata(audio!),
      portraitMetadata: portrait ? portraitMetadata(portrait, profile) : null
    });
    const persistence = {
      attemptId,
      upstreamTaskId: submission.upstreamTaskId,
      traceId: safeTrace(submission.traceId),
      submittedAt: observedAt,
      nextPollAt: firstPollAt(context.job.createdAt, context.attempt.providerKind as VideoProviderKind, settings)
    };
    const completed = await deps.repository.completeSubmission({
      ...persistence,
      claimToken: claim.claimToken
    });
    if (!completed) {
      const reconciled = await deps.repository.reconcileSubmission(persistence);
      if (!reconciled) {
        await deps.repository.markSubmissionAmbiguous({
          attemptId,
          claimToken: claim.claimToken,
          safeErrorCode: "VIDEO_SUBMISSION_ACK_UNKNOWN",
          observedAt
        });
      }
    }
  } catch (error) {
    if (providerCallStarted) {
      await deps.repository.markSubmissionAmbiguous({
        attemptId,
        claimToken: claim.claimToken,
        safeErrorCode: "VIDEO_SUBMISSION_ACK_UNKNOWN",
        observedAt
      });
    } else {
      await deps.repository.failClaim({
        attemptId,
        claimToken: claim.claimToken,
        safeErrorCode: safeProviderError(error),
        completedAt: observedAt,
        failureKind: "CONFIGURATION"
      });
    }
  }
}

async function advanceQueries(
  renderJobId: string,
  observedAt: Date,
  deps: RenderOrchestratorDependencies,
  includeTerminal: boolean
) {
  const context = await deps.repository.loadContext(renderJobId);
  if (!context) throw new Error("VIDEO_RENDER_NOT_FOUND");
  if (!includeTerminal && (context.job.status === "READY" || context.job.status === "FALLBACK")) return;
  const settings = settingsFromPersisted(context);
  const elapsed = observedAt.getTime() - context.job.createdAt.getTime();
  const due = new Set(getDueProviders(elapsed, settings));
  const claims = await Promise.all(context.attempts
    .filter((attempt) => due.has(attempt.providerKind as VideoProviderKind))
    .map(async (attempt) => ({ attempt, claim: await deps.repository.claimQuery(attempt.id, observedAt) })));
  await Promise.all(claims.map(async ({ attempt, claim }) => {
    if (!claim || !attempt.upstreamTaskId) return;
    try {
      const resolved = await deps.resolveVideoModel(attempt.modelId, attempt.providerKind as VideoProviderKind);
      if (resolved.providerId !== attempt.providerId) throw new RenderConfigurationError("VIDEO_MODEL_STALE");
      const result = await resolved.provider.query(attempt.upstreamTaskId);
      const nextPollAt = result.status === "RUNNING" || result.status === "PENDING"
        ? new Date(observedAt.getTime() + 3000)
        : null;
      await deps.repository.recordQuery({
        attemptId: attempt.id,
        claimToken: claim.claimToken,
        status: result.status,
        traceId: safeTrace(result.traceId),
        completedAt: result.completedAt,
        observedAt,
        nextPollAt,
        safeErrorCode: result.safeErrorCode,
        outputUrlEnvelope: result.status === "SUCCEEDED"
          ? deps.encryptOutputUrl(result.videoUrl)
          : null
      });
    } catch (error) {
      if (
        (error instanceof MediaProviderError || error instanceof MediaConfigurationError) &&
        error.retryable
      ) {
        await deps.repository.releaseQuery({
          attemptId: attempt.id,
          claimToken: claim.claimToken,
          observedAt,
          nextPollAt: new Date(observedAt.getTime() + 3000),
          safeErrorCode: safeProviderError(error)
        });
      } else {
        await deps.repository.failClaim({
          attemptId: attempt.id,
          claimToken: claim.claimToken,
          safeErrorCode: safeProviderError(error),
          completedAt: observedAt,
          failureKind: "PROVIDER_EXCEPTION"
        });
      }
    }
  }));
}

async function cachePending(renderJobId: string, observedAt: Date, deps: RenderOrchestratorDependencies) {
  const context = await deps.repository.loadContext(renderJobId);
  if (!context) throw new Error("VIDEO_RENDER_NOT_FOUND");
  await Promise.all(context.attempts.map(async (attempt) => {
    if (!attempt.outputUrlCiphertext || !attempt.outputUrlIv || !attempt.outputUrlTag) return;
    const claim = await deps.repository.claimCache(attempt.id, observedAt);
    if (!claim) return;
    let cached: { assetId: string; objectKey?: string; created?: boolean } | null = null;
    try {
      const videoUrl = deps.decryptOutputUrl({
        ciphertext: attempt.outputUrlCiphertext,
        iv: attempt.outputUrlIv,
        tag: attempt.outputUrlTag
      });
      cached = await deps.cacheOutput({ attemptId: attempt.id, videoUrl, observedAt });
      const attached = await deps.repository.completeCache({
        attemptId: attempt.id,
        claimToken: claim.claimToken,
        outputAssetId: cached.assetId
      });
      if (!attached) {
        await deps.repository.releaseCache({
          attemptId: attempt.id,
          claimToken: claim.claimToken,
          safeErrorCode: "VIDEO_OUTPUT_ATTACH_OWNERSHIP_LOST",
          observedAt,
          nextPollAt: new Date(observedAt.getTime() + 3000)
        });
      }
    } catch {
      await deps.repository.releaseCache({
        attemptId: attempt.id,
        claimToken: claim.claimToken,
        safeErrorCode: "VIDEO_OUTPUT_CACHE_FAILED",
        observedAt,
        nextPollAt: new Date(observedAt.getTime() + 3000)
      });
    }
  }));
}

async function ensurePresetFailureFallback(
  renderJobId: string,
  observedAt: Date,
  deps: RenderOrchestratorDependencies
) {
  const context = await deps.repository.loadContext(renderJobId);
  if (!context || context.job.kind !== "PRESET" || context.job.mode !== "AUTO_RACE") return;
  const lingmou = context.attempts.find((attempt) => attempt.providerKind === "LINGMOU_BROADCAST");
  if (!lingmou || lingmou.status !== "FAILED" || lingmou.failureKind !== "UPSTREAM_TERMINAL") return;
  const emo = context.attempts.find((attempt) => attempt.providerKind === "ALIBABA_EMO");
  if (emo) {
    await submitAttempt(emo.id, observedAt, settingsFromPersisted(context), deps);
    await deps.repository.refreshActiveStatus(renderJobId);
  }
}

function settingsFromPersisted(context: Awaited<ReturnType<RenderRepository["loadContext"]>> extends infer T ? NonNullable<T> : never): DigitalHumanVideoRuntimeSettings {
  const lingmou = context.attempts.find((attempt) => attempt.providerKind === "LINGMOU_BROADCAST");
  const emo = context.attempts.find((attempt) => attempt.providerKind === "ALIBABA_EMO");
  return {
    mode: context.job.mode as DigitalHumanVideoRuntimeSettings["mode"],
    maxWaitMs: 8000,
    lingmouPollMs: [3000, 6000],
    emoPollMs: [8000],
    synchronizeProfiles: !emo || emo.interviewerProfileId === lingmou?.interviewerProfileId,
    primaryProfileId: lingmou?.interviewerProfileId ?? emo?.interviewerProfileId ?? "",
    secondaryProfileId: emo?.interviewerProfileId ?? null,
    lingmouModelId: lingmou?.modelId ?? "",
    emoModelId: emo?.modelId ?? ""
  };
}

async function loadAttemptContext(renderJobId: string, attemptId: string, deps: RenderOrchestratorDependencies) {
  // Repository state is intentionally reloaded after every durable claim.
  const context = await deps.repository.loadContext(renderJobId);
  const attempt = context?.attempts.find((candidate) => candidate.id === attemptId);
  return context && attempt ? { job: context.job, attempt } : null;
}

function configuredProviders(mode: DigitalHumanVideoRuntimeSettings["mode"]): VideoProviderKind[] {
  if (mode === "LINGMOU_ONLY") return ["LINGMOU_BROADCAST"];
  if (mode === "EMO_ONLY") return ["ALIBABA_EMO"];
  return ["LINGMOU_BROADCAST", "ALIBABA_EMO"];
}

function initialSubmitProviders(kind: RenderJobKind, mode: DigitalHumanVideoRuntimeSettings["mode"]): VideoProviderKind[] {
  if (mode === "LINGMOU_ONLY") return ["LINGMOU_BROADCAST"];
  if (mode === "EMO_ONLY") return ["ALIBABA_EMO"];
  return kind === "DYNAMIC" ? ["LINGMOU_BROADCAST", "ALIBABA_EMO"] : ["LINGMOU_BROADCAST"];
}

function profileIdFor(settings: DigitalHumanVideoRuntimeSettings, provider: VideoProviderKind) {
  const id = provider === "ALIBABA_EMO" && !settings.synchronizeProfiles
    ? settings.secondaryProfileId
    : settings.primaryProfileId;
  if (!id) throw new RenderConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  return id;
}

function modelIdFor(settings: DigitalHumanVideoRuntimeSettings, provider: VideoProviderKind) {
  return provider === "LINGMOU_BROADCAST" ? settings.lingmouModelId : settings.emoModelId;
}

function firstPollAt(createdAt: Date, provider: VideoProviderKind, settings: DigitalHumanVideoRuntimeSettings) {
  const offset = provider === "LINGMOU_BROADCAST" ? settings.lingmouPollMs[0] : settings.emoPollMs[0];
  return new Date(createdAt.getTime() + offset);
}

function validateRenderInput(input: EnsureRenderInput, kind: RenderJobKind) {
  if (
    input.kind !== kind || !input.trainingSessionId || !input.questionId || !input.questionHash ||
    !input.cacheKey || !input.audioAssetId || input.deadlineAt.getTime() - input.createdAt.getTime() !== 8000
  ) throw new RenderConfigurationError("VIDEO_RENDER_INPUT_INVALID");
}

function validateProfile(profile: RenderProfile | null, id: string): asserts profile is RenderProfile {
  if (!profile || profile.id !== id || !profile.enabled || !profile.displayName.trim()) {
    throw new RenderConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
  }
}

function validateAsset(asset: InternalRenderAsset | null, purpose: string, observedAt: Date): asserts asset is InternalRenderAsset {
  if (
    !asset || asset.purpose !== purpose || asset.cleanupStatus !== "ACTIVE" || asset.byteLength <= 0 ||
    (asset.expiresAt !== null && asset.expiresAt <= observedAt)
  ) throw new RenderConfigurationError(`VIDEO_${purpose}_ASSET_INVALID`);
}

function audioMetadata(asset: InternalRenderAsset): VideoAssetMetadata {
  return {
    contentType: asset.mimeType,
    byteLength: asset.byteLength,
    ...(asset.mimeType === "audio/wav" ? { durationSeconds: Math.max(0.01, (asset.byteLength - 44) / 96_000) } : {})
  };
}

function portraitMetadata(asset: InternalRenderAsset, profile: RenderProfile): VideoAssetMetadata {
  let dimensions: { width?: number; height?: number } = {};
  try {
    const parsed = JSON.parse(profile.emoMappingJson ?? "{}") as Record<string, unknown>;
    if (typeof parsed.portraitWidth === "number" && typeof parsed.portraitHeight === "number") {
      dimensions = { width: parsed.portraitWidth, height: parsed.portraitHeight };
    }
  } catch { /* adapter validation returns a finite configuration failure */ }
  return { contentType: asset.mimeType, byteLength: asset.byteLength, ...dimensions };
}

function safeProviderError(error: unknown) {
  const code = error instanceof MediaProviderError || error instanceof MediaConfigurationError || error instanceof RenderConfigurationError
    ? error.code
    : null;
  return code && /^[A-Z0-9_]{1,100}$/.test(code) ? code : "VIDEO_PROVIDER_FAILED";
}

function safeTrace(value: string | null) {
  return value && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
}

class RenderConfigurationError extends Error {
  constructor(readonly code: string) {
    super("Digital human video render configuration is invalid");
  }
}

async function defaultResolveProfile(id: string): Promise<RenderProfile | null> {
  return prisma.interviewerAvatarProfile.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      portraitAssetId: true,
      enabled: true,
      emoMappingJson: true,
      lingmouMappingJson: true
    }
  });
}

async function defaultResolveVideoModel(id: string, providerKind: VideoProviderKind): Promise<ResolvedVideoProvider> {
  const model = await resolveMediaModelById(id, "DIGITAL_HUMAN_VIDEO");
  if (providerKind === "LINGMOU_BROADCAST") {
    const config = resolveLingmouBroadcastConfiguration(model);
    return {
      modelId: model.modelId,
      providerId: model.providerId,
      provider: createLingmouBroadcastProvider(model),
      requiresPortrait: config.portraitVariableName !== null,
      validateProfile(profile) {
        const mapping = parseProfileMapping(profile.lingmouMappingJson, "VIDEO_PROFILE_NOT_CONFIGURED");
        if (
          mapping.templateId !== config.templateId ||
          mapping.audioVariableName !== config.audioVariableName ||
          mapping.portraitVariableName !== config.portraitVariableName
        ) throw new RenderConfigurationError("VIDEO_PROFILE_NOT_CONFIGURED");
      }
    };
  }
  return {
    modelId: model.modelId,
    providerId: model.providerId,
    provider: createAlibabaEmoProvider(model),
    requiresPortrait: true,
    validateProfile(profile) {
      const mapping = parseProfileMapping(profile.emoMappingJson, "EMO_PORTRAIT_NOT_CONFIGURED");
      if (!validPortraitDimension(mapping.portraitWidth) || !validPortraitDimension(mapping.portraitHeight)) {
        throw new RenderConfigurationError("EMO_PORTRAIT_NOT_CONFIGURED");
      }
    }
  };
}

async function defaultLoadAsset(id: string): Promise<InternalRenderAsset | null> {
  return prisma.digitalHumanMediaAsset.findUnique({ where: { id } });
}

async function defaultCreateReadUrl(asset: InternalRenderAsset) {
  const config = await prisma.mediaStorageConfig.findUnique({ where: { id: asset.storageConfigId } });
  if (!config || !config.enabled) throw new RenderConfigurationError("VIDEO_STORAGE_NOT_CONFIGURED");
  return createOssPrivateMediaStorage(config, readAiConfigSecret()).createReadUrl(asset.objectKey, 300);
}

function renderPlanFingerprint(input: EnsureRenderInput, definitions: RenderAttemptDefinition[]) {
  const canonical = {
    trainingSessionId: input.trainingSessionId,
    questionId: input.questionId,
    questionHash: input.questionHash,
    cacheKey: input.cacheKey,
    kind: input.kind,
    mode: input.runtimeSettings.mode,
    audioAssetId: input.audioAssetId,
    createdAt: input.createdAt.toISOString(),
    deadlineAt: input.deadlineAt.toISOString(),
    synchronizeProfiles: input.runtimeSettings.synchronizeProfiles,
    primaryProfileId: input.runtimeSettings.primaryProfileId,
    secondaryProfileId: input.runtimeSettings.secondaryProfileId,
    attempts: [...definitions]
      .sort((left, right) => left.providerKind.localeCompare(right.providerKind))
      .map((attempt) => ({
        providerKind: attempt.providerKind,
        providerId: attempt.providerId,
        modelId: attempt.modelId,
        interviewerProfileId: attempt.interviewerProfileId,
        interviewerName: attempt.interviewerName,
        portraitAssetId: attempt.portraitAssetId
      }))
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parseProfileMapping(value: string | undefined, code: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new RenderConfigurationError(code);
  }
}

function validPortraitDimension(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 400 && value <= 7000;
}

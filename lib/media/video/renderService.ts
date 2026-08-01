import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { parseSavedOutline } from "@/lib/domain/trainingQuestions";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import { createVideoSpeechAsset } from "./speechAsset";
import { createRenderOrchestrator } from "./renderOrchestrator";
import { parseDigitalHumanVideoRuntimeSettings } from "./settings";
import { digitalHumanVideoRuntimeSettingKey } from "./diagnostics";
import { createSafeRenderResponse } from "./renderApi";
import type { DigitalHumanVideoRuntimeSettings, VideoProviderKind } from "./types";
import type { PrismaClient } from "@prisma/client";

export type RenderActor =
  | { type: "candidate"; trainingSessionId: string; candidateId: string }
  | { type: "admin"; adminId: string };

export class RenderRequestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "RenderRequestError";
  }
}

type PlaceholderRecord = Awaited<ReturnType<typeof loadPlaceholder>>;

const claimLeaseMs = 30_000;

export type RenderMaterializationDependencies = {
  database: PrismaClient;
  loadRuntimeSettings: () => Promise<DigitalHumanVideoRuntimeSettings>;
  createSpeechAsset: typeof createVideoSpeechAsset;
  createOrchestrator: typeof createRenderOrchestrator;
  makeClaimToken: () => string;
  now: () => Date;
};

export async function ensureRenderForQuestion(input: {
  actor: RenderActor;
  sessionId: string;
  questionId: string;
  kind: "PRESET" | "DYNAMIC";
  observedAt?: Date;
}) {
  const observedAt = input.observedAt ?? new Date();
  const placeholder = await loadAuthorizedPlaceholder(input.actor, input.sessionId, input.questionId, input.kind);
  const materialized = await materializePlaceholder(placeholder.id, observedAt);
  return safePlaceholder(materialized, observedAt);
}

export async function prewarmRenderQuestions(input: {
  actor: RenderActor;
  sessionId: string;
  currentQuestionId: string;
  observedAt?: Date;
}) {
  const observedAt = input.observedAt ?? new Date();
  await assertSessionAccess(input.actor, input.sessionId);
  const session = await prisma.trainingSession.findUnique({
    where: { id: input.sessionId },
    select: { outlineJson: true }
  });
  const outline = parseSavedOutline(session?.outlineJson ?? null);
  if (!outline) throw new RenderRequestError("SESSION_OUTLINE_UNAVAILABLE", 409);
  const currentIndex = outline.questions.findIndex((question) => question.id === input.currentQuestionId);
  if (currentIndex < 0) throw new RenderRequestError("UNKNOWN_SESSION_QUESTION", 400);
  const questionIds = outline.questions.slice(currentIndex, currentIndex + 2).map((question) => question.id);
  const placeholders = await prisma.digitalHumanRenderPlaceholder.findMany({
    where: {
      trainingSessionId: input.sessionId,
      questionId: { in: questionIds },
      kind: "PRESET"
    }
  });
  const byQuestion = new Map(placeholders.map((placeholder) => [placeholder.questionId, placeholder]));
  const ordered = questionIds.map((questionId) => byQuestion.get(questionId));
  if (ordered.some((placeholder) => !placeholder)) {
    throw new RenderRequestError("RENDER_PLACEHOLDER_UNAVAILABLE", 409);
  }
  const rendered = await Promise.all(ordered.map((placeholder) => materializePlaceholder(placeholder!.id, observedAt)));
  return { renders: rendered.map((placeholder) => safePlaceholder(placeholder, observedAt)) };
}

export async function getRenderForActor(input: {
  actor: RenderActor;
  renderId: string;
  observedAt?: Date;
  includeDiagnostics?: boolean;
}) {
  const observedAt = input.observedAt ?? new Date();
  let placeholder = await loadPlaceholder(input.renderId);
  if (!placeholder) throw new RenderRequestError("RENDER_NOT_FOUND", 404);
  await assertSessionAccess(input.actor, placeholder.trainingSessionId);
  if (input.includeDiagnostics && input.actor.type !== "admin") {
    throw new RenderRequestError("ADMIN_DIAGNOSTICS_REQUIRED", 403);
  }
  if (placeholder.renderJobId) {
    await createRenderOrchestrator().advance(placeholder.renderJobId, observedAt);
    placeholder = await loadPlaceholder(input.renderId);
  } else if (
    placeholder.status === "MATERIALIZING" &&
    (!placeholder.claimExpiresAt || placeholder.claimExpiresAt <= observedAt)
  ) {
    placeholder = await recoverExpiredMaterialization(placeholder.id, observedAt);
  } else if (placeholder.status === "SYNTHESIZING" && placeholder.claimExpiresAt && placeholder.claimExpiresAt <= observedAt) {
    await markExpiredSynthesisAmbiguous(placeholder.id, observedAt);
    placeholder = await loadPlaceholder(input.renderId);
  }
  if (!placeholder) throw new RenderRequestError("RENDER_NOT_FOUND", 404);
  const response: Record<string, unknown> = safePlaceholder(placeholder, observedAt);
  if (input.includeDiagnostics && placeholder.renderJobId) {
    const attempts = await prisma.digitalHumanRenderAttempt.findMany({
      where: { renderJobId: placeholder.renderJobId },
      orderBy: { providerKind: "asc" },
      select: { providerKind: true, status: true, safeErrorCode: true, traceId: true }
    });
    response.diagnostics = attempts.map((attempt) => ({
      providerLabel: attempt.providerKind === "LINGMOU_BROADCAST" ? "灵眸播报" : "阿里云 EMO",
      status: safeStatus(attempt.status),
      safeErrorCode: finiteCode(attempt.safeErrorCode),
      traceId: finiteTrace(attempt.traceId)
    }));
  }
  return response;
}

export async function loadPlaybackAsset(actor: RenderActor, renderId: string) {
  const placeholder = await loadPlaceholder(renderId);
  if (!placeholder) throw new RenderRequestError("RENDER_NOT_FOUND", 404);
  await assertSessionAccess(actor, placeholder.trainingSessionId);
  if (placeholder.status !== "MATERIALIZED" || !placeholder.renderJobId) {
    throw new RenderRequestError("PLAYBACK_NOT_READY", 409);
  }
  const job = await prisma.digitalHumanRenderJob.findUnique({
    where: { id: placeholder.renderJobId },
    include: {
      winnerAttempt: {
        include: { outputAsset: { include: { storageConfig: true } } }
      }
    }
  });
  const asset = job?.status === "READY" ? job.winnerAttempt?.outputAsset : null;
  if (
    !asset || asset.purpose !== "VIDEO_OUTPUT" || asset.cleanupStatus !== "ACTIVE" ||
    asset.mimeType !== "video/mp4" || asset.byteLength <= 0 ||
    (asset.expiresAt !== null && asset.expiresAt <= new Date())
  ) {
    throw new RenderRequestError("PLAYBACK_NOT_READY", 409);
  }
  const storage = createOssPrivateMediaStorage(asset.storageConfig, readAiConfigSecret());
  return {
    byteLength: asset.byteLength,
    mimeType: "video/mp4" as const,
    createUpstreamUrl: () => storage.createReadUrl(asset.objectKey, 60)
  };
}

export async function materializeRenderPlaceholder(
  id: string,
  observedAt: Date,
  overrides: Partial<RenderMaterializationDependencies> = {}
) {
  const deps: RenderMaterializationDependencies = {
    database: prisma,
    loadRuntimeSettings: () => loadRuntimeSettings(prisma),
    createSpeechAsset: createVideoSpeechAsset,
    createOrchestrator: createRenderOrchestrator,
    makeClaimToken: randomUUID,
    now: () => new Date(),
    ...overrides
  };
  const database = deps.database;
  let placeholder = await loadPlaceholder(id, database);
  if (!placeholder) throw new RenderRequestError("RENDER_NOT_FOUND", 404);
  if (["MATERIALIZED", "FALLBACK"].includes(placeholder.status)) return placeholder;

  if (placeholder.status === "SYNTHESIZING") {
    if (placeholder.claimExpiresAt && placeholder.claimExpiresAt <= observedAt) {
      await markExpiredSynthesisAmbiguous(id, observedAt, database);
      return (await loadPlaceholder(id, database))!;
    }
    return placeholder;
  }

  let settings: DigitalHumanVideoRuntimeSettings;
  try {
    settings = placeholder.runtimeSettingsJson
      ? parseDigitalHumanVideoRuntimeSettings(placeholder.runtimeSettingsJson)
      : await deps.loadRuntimeSettings();
  } catch {
    await database.digitalHumanRenderPlaceholder.updateMany({
      where: {
        id,
        status: "PENDING",
        claimToken: null,
        updatedAt: placeholder.updatedAt
      },
      data: {
        status: "FALLBACK",
        fallbackReason: "VIDEO_RUNTIME_NOT_CONFIGURED",
        claimExpiresAt: null
      }
    });
    return (await loadPlaceholder(id, database))!;
  }

  const claimToken = deps.makeClaimToken();
  if (!placeholder.audioAssetId) {
    const claimed = await database.digitalHumanRenderPlaceholder.updateMany({
      where: { id, status: "PENDING", claimToken: null },
      data: {
        status: "SYNTHESIZING",
        claimToken,
        claimExpiresAt: new Date(observedAt.getTime() + claimLeaseMs),
        runtimeSettingsJson: JSON.stringify(settings)
      }
    });
    if (claimed.count !== 1) return (await loadPlaceholder(id, database))!;
    placeholder = (await loadPlaceholder(id, database))!;
    try {
      const speech = await deps.createSpeechAsset({
        sessionId: placeholder.trainingSessionId,
        questionId: placeholder.questionId,
        question: placeholder.questionText,
        stage: placeholder.stage,
        interviewerProfileId: settings.primaryProfileId,
        behaviorSignals: parseSignals(placeholder.behaviorSignalsJson)
      });
      const speechReadyAt = deps.now();
      const attached = await database.digitalHumanRenderPlaceholder.updateMany({
        where: { id, status: "SYNTHESIZING", claimToken, claimExpiresAt: { gt: speechReadyAt } },
        data: {
          audioAssetId: speech.assetId,
          status: "MATERIALIZING",
          renderCreatedAt: speechReadyAt,
          deadlineAt: new Date(speechReadyAt.getTime() + 8_000),
          claimExpiresAt: new Date(speechReadyAt.getTime() + claimLeaseMs)
        }
      });
      if (attached.count !== 1) {
        await markExpiredSynthesisAmbiguous(id, speechReadyAt, database);
        return (await loadPlaceholder(id, database))!;
      }
    } catch {
      await fallbackPlaceholder(id, "VIDEO_SPEECH_FAILED", claimToken, database);
      return (await loadPlaceholder(id, database))!;
    }
  } else {
    const claimed = await database.digitalHumanRenderPlaceholder.updateMany({
      where: {
        id,
        status: "MATERIALIZING",
        OR: [{ claimToken: null }, { claimExpiresAt: { lte: observedAt } }]
      },
      data: { claimToken, claimExpiresAt: new Date(observedAt.getTime() + claimLeaseMs) }
    });
    if (claimed.count !== 1) return (await loadPlaceholder(id, database))!;
  }

  placeholder = (await loadPlaceholder(id, database))!;
  if (!placeholder.audioAssetId || !placeholder.runtimeSettingsJson || !placeholder.renderCreatedAt || !placeholder.deadlineAt) {
    await fallbackPlaceholder(id, "VIDEO_MATERIALIZATION_STATE_INVALID", claimToken, database);
    return (await loadPlaceholder(id, database))!;
  }
  try {
    const orchestrator = deps.createOrchestrator();
    const renderInput = {
      trainingSessionId: placeholder.trainingSessionId,
      questionId: placeholder.questionId,
      questionHash: placeholder.questionHash,
      cacheKey: placeholder.cacheKey,
      kind: placeholder.kind as "PRESET" | "DYNAMIC",
      audioAssetId: placeholder.audioAssetId,
      createdAt: placeholder.renderCreatedAt,
      deadlineAt: placeholder.deadlineAt,
      runtimeSettings: parseDigitalHumanVideoRuntimeSettings(placeholder.runtimeSettingsJson)
    };
    const snapshot = placeholder.kind === "DYNAMIC"
      ? await orchestrator.startDynamicRace(renderInput)
      : await orchestrator.ensurePresetJob(renderInput);
    await database.digitalHumanRenderPlaceholder.updateMany({
      where: { id, status: "MATERIALIZING", claimToken },
      data: { status: "MATERIALIZED", renderJobId: snapshot.id, claimToken: null, claimExpiresAt: null }
    });
  } catch {
    await fallbackPlaceholder(id, "VIDEO_RENDER_UNAVAILABLE", claimToken, database);
  }
  return (await loadPlaceholder(id, database))!;
}

export async function recoverExpiredMaterialization(
  id: string,
  observedAt: Date,
  overrides: Partial<RenderMaterializationDependencies> = {}
) {
  const database = overrides.database ?? prisma;
  const placeholder = await loadPlaceholder(id, database);
  if (!placeholder) throw new RenderRequestError("RENDER_NOT_FOUND", 404);
  if (
    placeholder.status !== "MATERIALIZING" ||
    placeholder.renderJobId ||
    (placeholder.claimExpiresAt && placeholder.claimExpiresAt > observedAt)
  ) {
    return placeholder;
  }
  return materializeRenderPlaceholder(id, observedAt, overrides);
}

export async function resolveSessionVideoAvailability(database: PrismaClient = prisma) {
  try {
    const settings = await loadRuntimeSettings(database);
    const requiredProfileIds = settings.synchronizeProfiles
      ? [settings.primaryProfileId]
      : [settings.primaryProfileId, settings.secondaryProfileId!];
    const profiles = await database.interviewerAvatarProfile.findMany({
      where: { id: { in: requiredProfileIds }, enabled: true },
      select: { id: true }
    });
    if (new Set(profiles.map(({ id }) => id)).size !== new Set(requiredProfileIds).size) {
      throw new Error("profile unavailable");
    }
    return { status: "PENDING" as const, fallbackAvailable: true };
  } catch {
    return {
      status: "FALLBACK" as const,
      fallbackAvailable: true,
      reason: "VIDEO_RUNTIME_NOT_CONFIGURED"
    };
  }
}

const materializePlaceholder = materializeRenderPlaceholder;

async function loadRuntimeSettings(database: PrismaClient) {
  const row = await database.aiRuntimeSetting.findUnique({ where: { key: digitalHumanVideoRuntimeSettingKey } });
  if (!row) throw new Error("not configured");
  return parseDigitalHumanVideoRuntimeSettings(row.valueJson);
}

async function loadAuthorizedPlaceholder(actor: RenderActor, sessionId: string, questionId: string, kind: string) {
  await assertSessionAccess(actor, sessionId);
  const placeholder = await prisma.digitalHumanRenderPlaceholder.findFirst({
    where: { trainingSessionId: sessionId, questionId, kind }
  });
  if (!placeholder) throw new RenderRequestError("UNKNOWN_SESSION_QUESTION", 400);
  return placeholder;
}

async function assertSessionAccess(actor: RenderActor, sessionId: string) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: { candidateId: true }
  });
  if (!session) throw new RenderRequestError("SESSION_NOT_FOUND", 404);
  if (actor.type === "candidate" && (
    actor.trainingSessionId !== sessionId || actor.candidateId !== session.candidateId
  )) throw new RenderRequestError("RENDER_ACCESS_DENIED", 403);
}

async function loadPlaceholder(id: string, database: PrismaClient = prisma) {
  return database.digitalHumanRenderPlaceholder.findUnique({
    where: { id },
    include: { renderJob: { include: { winnerAttempt: true } } }
  });
}

function safePlaceholder(placeholder: NonNullable<PlaceholderRecord>, observedAt: Date) {
  const job = placeholder.renderJob;
  const status = placeholder.status === "FALLBACK" ? "FALLBACK" : job?.status ?? "PENDING";
  return createSafeRenderResponse({
    id: placeholder.id,
    status,
    deadlineAt: placeholder.deadlineAt ?? new Date(placeholder.createdAt.getTime() + 8_000),
    createdAt: placeholder.renderCreatedAt ?? placeholder.createdAt,
    winnerProvider: (job?.winnerAttempt?.providerKind as VideoProviderKind | undefined) ?? null,
    winnerInterviewer: job?.winnerAttempt?.interviewerName ?? null,
    fallbackReason: placeholder.fallbackReason ?? job?.fallbackReason ?? null
  }, observedAt);
}

async function fallbackPlaceholder(id: string, reason: string, claimToken?: string, database: PrismaClient = prisma) {
  await database.digitalHumanRenderPlaceholder.updateMany({
    where: { id, ...(claimToken ? { claimToken } : {}) },
    data: {
      status: "FALLBACK",
      fallbackReason: finiteCode(reason) ?? "VIDEO_RENDER_UNAVAILABLE",
      claimToken: null,
      claimExpiresAt: null
    }
  });
}

async function markExpiredSynthesisAmbiguous(id: string, observedAt: Date, database: PrismaClient = prisma) {
  await database.digitalHumanRenderPlaceholder.updateMany({
    where: { id, status: "SYNTHESIZING", claimExpiresAt: { lte: observedAt } },
    data: {
      status: "FALLBACK",
      fallbackReason: "VIDEO_SPEECH_SUBMISSION_AMBIGUOUS",
      claimToken: null,
      claimExpiresAt: null
    }
  });
}

function parseSignals(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function safeStatus(value: string) {
  return /^[A-Z0-9_]{1,100}$/.test(value) ? value : "UNKNOWN";
}

function finiteCode(value: string | null) {
  return value && /^[A-Z0-9_]{1,100}$/.test(value) ? value : null;
}

function finiteTrace(value: string | null) {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

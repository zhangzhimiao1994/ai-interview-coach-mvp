import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import type { VideoProviderKind, VideoRenderMode } from "./types";

export type RenderJobKind = "PRESET" | "DYNAMIC";

export type RenderAttemptDefinition = {
  providerKind: VideoProviderKind;
  providerId: string;
  modelId: string;
  interviewerProfileId: string;
  interviewerName: string;
  portraitAssetId: string | null;
};

export type EnsurePersistedRenderInput = {
  trainingSessionId: string;
  questionId: string;
  questionHash: string;
  cacheKey: string;
  kind: RenderJobKind;
  mode: VideoRenderMode;
  interviewerProfileId: string;
  audioAssetId: string;
  createdAt: Date;
  deadlineAt: Date;
  attempts: RenderAttemptDefinition[];
};

export type RenderSnapshot = {
  id: string;
  status: string;
  deadlineAt: string;
  readyAt: string | null;
  winnerProvider: VideoProviderKind | null;
  winnerInterviewer: string | null;
  winnerAssetId: string | null;
  fallbackReason: string | null;
};

export type RenderOperationClaim = {
  attemptId: string;
  renderJobId: string;
  claimToken: string;
  claimExpiresAt: Date;
};

export type PersistedRenderContext = {
  job: {
    id: string;
    kind: string;
    mode: string;
    status: string;
    audioAssetId: string | null;
    createdAt: Date;
    deadlineAt: Date;
    winnerAttemptId: string | null;
  };
  attempts: Array<{
    id: string;
    providerKind: string;
    providerId: string;
    modelId: string;
    interviewerProfileId: string | null;
    interviewerName: string;
    portraitAssetId: string | null;
    status: string;
    upstreamTaskId: string | null;
    submittedAt: Date | null;
    nextPollAt: Date | null;
    completedAt: Date | null;
    successObservedAt: Date | null;
    outputAssetId: string | null;
    outputUrlCiphertext: string | null;
    outputUrlIv: string | null;
    outputUrlTag: string | null;
  }>;
};

export interface RenderRepository {
  ensureJob(input: EnsurePersistedRenderInput): Promise<RenderSnapshot>;
  getSnapshot(id: string): Promise<RenderSnapshot | null>;
  loadContext(id: string): Promise<PersistedRenderContext | null>;
  claimSubmission(attemptId: string, observedAt: Date): Promise<RenderOperationClaim | null>;
  completeSubmission(input: {
    attemptId: string;
    claimToken: string;
    upstreamTaskId: string;
    traceId: string | null;
    submittedAt: Date;
    nextPollAt: Date;
  }): Promise<boolean>;
  failClaim(input: {
    attemptId: string;
    claimToken: string;
    safeErrorCode: string;
    completedAt: Date;
  }): Promise<boolean>;
  claimQuery(attemptId: string, observedAt: Date): Promise<RenderOperationClaim | null>;
  recordQuery(input: {
    attemptId: string;
    claimToken: string;
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    traceId: string | null;
    completedAt: Date | null;
    observedAt: Date;
    nextPollAt: Date | null;
    safeErrorCode: string | null;
    outputUrlEnvelope: { ciphertext: string; iv: string; tag: string } | null;
  }): Promise<boolean>;
  claimCache(attemptId: string, observedAt: Date): Promise<RenderOperationClaim | null>;
  completeCache(input: { attemptId: string; claimToken: string; outputAssetId: string }): Promise<boolean>;
  chooseWinner(renderJobId: string, observedAt: Date): Promise<void>;
  finalizeFallback(renderJobId: string, observedAt: Date, reason: string): Promise<void>;
  refreshActiveStatus(renderJobId: string): Promise<void>;
}

type RenderPrisma = PrismaClient;

export function createPrismaRenderRepository(
  client: RenderPrisma = defaultPrisma,
  options: { claimLeaseMs?: number; makeClaimToken?: () => string } = {}
): RenderRepository {
  const claimLeaseMs = options.claimLeaseMs ?? 30_000;
  const makeClaimToken = options.makeClaimToken ?? randomUUID;

  return {
    async ensureJob(input) {
      validateEnsureInput(input);
      try {
        const created = await client.$transaction(async (tx) => {
          return tx.digitalHumanRenderJob.create({
            data: {
              trainingSessionId: input.trainingSessionId,
              questionId: input.questionId,
              questionHash: input.questionHash,
              cacheKey: input.cacheKey,
              kind: input.kind,
              mode: input.mode,
              interviewerProfileId: input.interviewerProfileId,
              audioAssetId: input.audioAssetId,
              status: "PENDING",
              createdAt: input.createdAt,
              deadlineAt: input.deadlineAt,
              attempts: {
                create: input.attempts.map((attempt) => ({
                  providerKind: attempt.providerKind,
                  providerId: attempt.providerId,
                  modelId: attempt.modelId,
                  interviewerProfileId: attempt.interviewerProfileId,
                  interviewerName: attempt.interviewerName,
                  portraitAssetId: attempt.portraitAssetId,
                  status: "PENDING"
                }))
              }
            }
          });
        });
        return snapshot(client, created.id);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        const existing = await client.digitalHumanRenderJob.findUnique({
          where: {
            trainingSessionId_questionId_cacheKey: {
              trainingSessionId: input.trainingSessionId,
              questionId: input.questionId,
              cacheKey: input.cacheKey
            }
          }
        });
        if (!existing || existing.questionHash !== input.questionHash || existing.audioAssetId !== input.audioAssetId) {
          throw new Error("VIDEO_RENDER_IDEMPOTENCY_CONFLICT");
        }
        return snapshot(client, existing.id);
      }
    },

    getSnapshot(id) {
      return snapshotOrNull(client, id);
    },

    async loadContext(id) {
      const job = await client.digitalHumanRenderJob.findUnique({
        where: { id },
        include: { attempts: true }
      });
      if (!job) return null;
      return { job, attempts: job.attempts };
    },

    claimSubmission(attemptId, observedAt) {
      return claimOperation(client, {
        attemptId,
        observedAt,
        operation: "SUBMIT",
        activeStatus: "SUBMITTING",
        eligible: ["PENDING"],
        claimLeaseMs,
        makeClaimToken
      });
    },

    async completeSubmission(input) {
      const result = await client.digitalHumanRenderAttempt.updateMany({
        where: {
          id: input.attemptId,
          status: "SUBMITTING",
          claimOperation: "SUBMIT",
          claimToken: input.claimToken
        },
        data: {
          status: "SUBMITTED",
          upstreamTaskId: input.upstreamTaskId,
          traceId: input.traceId,
          submittedAt: input.submittedAt,
          nextPollAt: input.nextPollAt,
          claimOperation: null,
          claimToken: null,
          claimExpiresAt: null
        }
      });
      return result.count === 1;
    },

    async failClaim(input) {
      const result = await client.digitalHumanRenderAttempt.updateMany({
        where: { id: input.attemptId, claimToken: input.claimToken },
        data: {
          status: "FAILED",
          safeErrorCode: finiteSafeCode(input.safeErrorCode),
          completedAt: input.completedAt,
          nextPollAt: null,
          claimOperation: null,
          claimToken: null,
          claimExpiresAt: null
        }
      });
      return result.count === 1;
    },

    claimQuery(attemptId, observedAt) {
      return claimOperation(client, {
        attemptId,
        observedAt,
        operation: "QUERY",
        activeStatus: "QUERYING",
        eligible: ["SUBMITTED", "RUNNING"],
        claimLeaseMs,
        makeClaimToken,
        requireDuePoll: true
      });
    },

    async recordQuery(input) {
      const terminal = input.status === "SUCCEEDED" || input.status === "FAILED";
      const result = await client.digitalHumanRenderAttempt.updateMany({
        where: {
          id: input.attemptId,
          status: "QUERYING",
          claimOperation: "QUERY",
          claimToken: input.claimToken
        },
        data: {
          status: input.status === "SUCCEEDED" ? "OUTPUT_PENDING" : input.status,
          traceId: input.traceId,
          firstQueriedAt: { set: input.observedAt },
          completedAt: input.completedAt,
          successObservedAt: input.status === "SUCCEEDED" ? input.observedAt : null,
          nextPollAt: terminal ? null : input.nextPollAt,
          safeErrorCode: input.status === "FAILED"
            ? finiteSafeCode(input.safeErrorCode ?? "VIDEO_PROVIDER_FAILED")
            : null,
          outputUrlCiphertext: input.outputUrlEnvelope?.ciphertext ?? null,
          outputUrlIv: input.outputUrlEnvelope?.iv ?? null,
          outputUrlTag: input.outputUrlEnvelope?.tag ?? null,
          claimOperation: null,
          claimToken: null,
          claimExpiresAt: null
        }
      });
      return result.count === 1;
    },

    claimCache(attemptId, observedAt) {
      return claimOperation(client, {
        attemptId,
        observedAt,
        operation: "CACHE",
        activeStatus: "CACHING",
        eligible: ["OUTPUT_PENDING"],
        claimLeaseMs,
        makeClaimToken
      });
    },

    async completeCache(input) {
      const result = await client.digitalHumanRenderAttempt.updateMany({
        where: {
          id: input.attemptId,
          status: "CACHING",
          claimOperation: "CACHE",
          claimToken: input.claimToken
        },
        data: {
          status: "SUCCEEDED",
          outputAssetId: input.outputAssetId,
          outputUrlCiphertext: null,
          outputUrlIv: null,
          outputUrlTag: null,
          claimOperation: null,
          claimToken: null,
          claimExpiresAt: null
        }
      });
      return result.count === 1;
    },

    async chooseWinner(renderJobId, observedAt) {
      await client.$transaction(async (tx) => {
        const job = await tx.digitalHumanRenderJob.findUnique({
          where: { id: renderJobId },
          include: { attempts: true }
        });
        if (!job || job.status === "READY" || job.status === "FALLBACK") return;
        if (observedAt >= job.deadlineAt) return;
        if (job.attempts.some((attempt) => attempt.status === "QUERYING")) return;
        const candidates = job.attempts.filter((attempt) =>
          attempt.status === "SUCCEEDED" &&
          attempt.outputAssetId &&
          attempt.successObservedAt &&
          attempt.successObservedAt < job.deadlineAt
        );
        candidates.sort((left, right) => {
          const observed = left.successObservedAt!.getTime() - right.successObservedAt!.getTime();
          if (observed !== 0) return observed;
          const leftCompletion = trustworthyAttemptCompletion(left, observedAt);
          const rightCompletion = trustworthyAttemptCompletion(right, observedAt);
          if (leftCompletion !== rightCompletion) return leftCompletion - rightCompletion;
          return left.providerKind === "LINGMOU_BROADCAST" ? -1 : 1;
        });
        const winner = candidates[0];
        if (!winner) return;
        await tx.digitalHumanRenderJob.updateMany({
          where: { id: renderJobId, winnerAttemptId: null, status: { notIn: ["READY", "FALLBACK"] } },
          data: { status: "READY", winnerAttemptId: winner.id, readyAt: observedAt }
        });
      });
    },

    async finalizeFallback(renderJobId, observedAt, reason) {
      await client.digitalHumanRenderJob.updateMany({
        where: {
          id: renderJobId,
          deadlineAt: { lte: observedAt },
          winnerAttemptId: null,
          status: { notIn: ["READY", "FALLBACK"] }
        },
        data: { status: "FALLBACK", fallbackReason: finiteSafeCode(reason) }
      });
    },

    async refreshActiveStatus(renderJobId) {
      await client.$transaction(async (tx) => {
        const job = await tx.digitalHumanRenderJob.findUnique({
          where: { id: renderJobId },
          include: { attempts: { select: { status: true } } }
        });
        if (!job || ["READY", "FALLBACK", "FAILED", "EXPIRED"].includes(job.status)) return;
        const active = job.attempts.filter((attempt) =>
          ["SUBMITTED", "RUNNING", "QUERYING", "OUTPUT_PENDING", "CACHING", "SUCCEEDED"].includes(attempt.status)
        ).length;
        if (active === 0) return;
        const status = job.kind === "DYNAMIC" && job.mode === "AUTO_RACE" && active >= 2
          ? "RACING"
          : "SUBMITTED";
        await tx.digitalHumanRenderJob.update({ where: { id: renderJobId }, data: { status } });
      });
    }
  };
}

async function claimOperation(
  client: RenderPrisma,
  input: {
    attemptId: string;
    observedAt: Date;
    operation: "SUBMIT" | "QUERY" | "CACHE";
    activeStatus: string;
    eligible: string[];
    claimLeaseMs: number;
    makeClaimToken: () => string;
    requireDuePoll?: boolean;
  }
): Promise<RenderOperationClaim | null> {
  const claimToken = input.makeClaimToken();
  const claimExpiresAt = new Date(input.observedAt.getTime() + input.claimLeaseMs);
  const result = await client.digitalHumanRenderAttempt.updateMany({
    where: {
      id: input.attemptId,
      ...(input.requireDuePoll ? { nextPollAt: { lte: input.observedAt } } : {}),
      OR: [
        { status: { in: input.eligible }, claimOperation: null },
        {
          status: input.activeStatus,
          claimOperation: input.operation,
          claimExpiresAt: { lte: input.observedAt }
        }
      ]
    },
    data: {
      status: input.activeStatus,
      claimOperation: input.operation,
      claimToken,
      claimExpiresAt
    }
  });
  if (result.count !== 1) return null;
  const attempt = await client.digitalHumanRenderAttempt.findUnique({
    where: { id: input.attemptId },
    select: { renderJobId: true }
  });
  return attempt
    ? { attemptId: input.attemptId, renderJobId: attempt.renderJobId, claimToken, claimExpiresAt }
    : null;
}

function trustworthyAttemptCompletion(
  attempt: { submittedAt: Date | null; completedAt: Date | null },
  observedAt: Date
) {
  const submitted = attempt.submittedAt?.getTime();
  const completed = attempt.completedAt?.getTime();
  return submitted === undefined || completed === undefined || completed < submitted || completed > observedAt.getTime()
    ? Number.POSITIVE_INFINITY
    : completed;
}

async function snapshot(client: RenderPrisma, id: string): Promise<RenderSnapshot> {
  const value = await snapshotOrNull(client, id);
  if (!value) throw new Error("VIDEO_RENDER_NOT_FOUND");
  return value;
}

async function snapshotOrNull(client: RenderPrisma, id: string): Promise<RenderSnapshot | null> {
  const job = await client.digitalHumanRenderJob.findUnique({ where: { id } });
  if (!job) return null;
  const winner = job.winnerAttemptId
    ? await client.digitalHumanRenderAttempt.findUnique({ where: { id: job.winnerAttemptId } })
    : null;
  return {
    id: job.id,
    status: job.status,
    deadlineAt: job.deadlineAt.toISOString(),
    readyAt: job.readyAt?.toISOString() ?? null,
    winnerProvider: winner?.providerKind as VideoProviderKind | undefined ?? null,
    winnerInterviewer: winner?.interviewerName ?? null,
    winnerAssetId: winner?.outputAssetId ?? null,
    fallbackReason: job.fallbackReason
  };
}

function validateEnsureInput(input: EnsurePersistedRenderInput) {
  if (
    !input.trainingSessionId || !input.questionId || !input.questionHash ||
    !input.cacheKey || !input.interviewerProfileId || !input.audioAssetId ||
    input.attempts.length === 0 || input.deadlineAt <= input.createdAt
  ) {
    throw new Error("VIDEO_RENDER_INPUT_INVALID");
  }
}

function finiteSafeCode(value: string) {
  return /^[A-Z0-9_]{1,100}$/.test(value) ? value : "VIDEO_PROVIDER_FAILED";
}

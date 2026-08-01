import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createPrismaRenderRepository } from "@/lib/media/video/renderRepository";
import { createRenderOrchestrator } from "@/lib/media/video/renderOrchestrator";
import type { AsyncAvatarVideoProvider, DigitalHumanVideoRuntimeSettings } from "@/lib/media/video/types";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";

const root = process.cwd();
const prismaDirectory = join(root, "prisma");
const migrationsDirectory = join(prismaDirectory, "migrations");
const prismaCliPath = join(root, "node_modules/prisma/build/index.js");

describe("persistent video render orchestration", () => {
  it("migrates durable render inputs and recoverable operation leases", async () => {
    await withTemporaryPrisma(async (prisma) => {
      const jobColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("DigitalHumanRenderJob")'
      );
      const attemptColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("DigitalHumanRenderAttempt")'
      );
      expect(jobColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "audioAssetId",
        "planFingerprint"
      ]));
      expect(attemptColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "interviewerProfileId",
        "portraitAssetId",
        "claimOperation",
        "claimToken",
        "claimExpiresAt",
        "successObservedAt"
      ]));
      const jobForeignKeys = await prisma.$queryRawUnsafe<Array<{ from: string; table: string }>>(
        'PRAGMA foreign_key_list("DigitalHumanRenderJob")'
      );
      const attemptForeignKeys = await prisma.$queryRawUnsafe<Array<{ from: string; table: string }>>(
        'PRAGMA foreign_key_list("DigitalHumanRenderAttempt")'
      );
      expect(jobForeignKeys).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: "audioAssetId", table: "DigitalHumanMediaAsset" })
      ]));
      expect(attemptForeignKeys).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: "interviewerProfileId", table: "InterviewerAvatarProfile" }),
        expect.objectContaining({ from: "portraitAssetId", table: "DigitalHumanMediaAsset" })
      ]));
    });
  });

  it("reuses a unique job and persists one provider attempt", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      const repository = createPrismaRenderRepository(prisma, {
        claimLeaseMs: 30_000,
        makeClaimToken: sequence("claim")
      });
      const input = renderInput();
      const first = await repository.ensureJob(input);
      const second = await repository.ensureJob(input);

      expect(second.id).toBe(first.id);
      expect(await prisma.digitalHumanRenderJob.count()).toBe(1);
      expect(await prisma.digitalHumanRenderAttempt.count()).toBe(1);
      expect(first).toMatchObject({
        status: "PENDING",
        winnerProvider: null,
        winnerAssetId: null
      });
      expect(JSON.stringify(first)).not.toMatch(/audio-object|portrait-object|signed|secret/i);
    });
  });

  it("never replays an expired submission claim and persists its ambiguous state", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      const repository = createPrismaRenderRepository(prisma, {
        claimLeaseMs: 30_000,
        makeClaimToken: sequence("claim")
      });
      const createdAt = new Date("2026-08-01T00:00:00.000Z");
      await repository.ensureJob(renderInput(createdAt));
      const attempt = await prisma.digitalHumanRenderAttempt.findFirstOrThrow();

      const first = await repository.claimSubmission(attempt.id, createdAt);
      expect(first?.claimToken).toBe("claim-1");
      await expect(repository.claimSubmission(attempt.id, new Date(createdAt.getTime() + 29_999)))
        .resolves.toBeNull();
      await expect(repository.expireSubmissionClaims(attempt.renderJobId, new Date(createdAt.getTime() + 30_000)))
        .resolves.toBe(1);
      await expect(repository.claimSubmission(attempt.id, new Date(createdAt.getTime() + 30_000)))
        .resolves.toBeNull();
      expect(await prisma.digitalHumanRenderAttempt.findUnique({ where: { id: attempt.id } }))
        .toMatchObject({
          status: "AMBIGUOUS_SUBMISSION",
          failureKind: "AMBIGUOUS_SUBMISSION",
          upstreamTaskId: null,
          claimToken: null
        });
    });
  });

  it("reconciles an upstream task when the submission database acknowledgement is reported lost", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      const base = createPrismaRenderRepository(prisma, { makeClaimToken: sequence("claim") });
      const repository = {
        ...base,
        async completeSubmission(_input: Parameters<typeof base.completeSubmission>[0]) {
          return false;
        }
      };
      const orchestrator = createRenderOrchestrator({
        ...testDependencies(prisma, calls, providers),
        repository
      });

      const snapshot = await orchestrator.ensurePresetJob(orchestratorInput("PRESET"));
      expect(calls.submit).toEqual(["LINGMOU_BROADCAST"]);
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: snapshot.id, providerKind: "LINGMOU_BROADCAST" } }
      })).toMatchObject({ status: "SUBMITTED", upstreamTaskId: "task-LINGMOU_BROADCAST" });
    });
  });

  it("quarantines an uncertain paid submission and never replays it", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      providers.LINGMOU_BROADCAST.submit = async () => {
        calls.submit.push("LINGMOU_BROADCAST");
        throw new MediaProviderError(
          "the response was lost after the provider accepted the request",
          "alibaba-lingmou",
          "UPSTREAM_TIMEOUT",
          true
        );
      };
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const input = orchestratorInput("PRESET");

      const first = await orchestrator.ensurePresetJob(input);
      const duplicate = await orchestrator.ensurePresetJob(input);

      expect(duplicate.id).toBe(first.id);
      expect(calls.submit).toEqual(["LINGMOU_BROADCAST"]);
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: first.id, providerKind: "LINGMOU_BROADCAST" } }
      })).toMatchObject({
        status: "AMBIGUOUS_SUBMISSION",
        failureKind: "AMBIGUOUS_SUBMISSION",
        safeErrorCode: "VIDEO_SUBMISSION_ACK_UNKNOWN",
        upstreamTaskId: null,
        claimToken: null
      });
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: first.id, providerKind: "ALIBABA_EMO" } }
      })).toMatchObject({ status: "PENDING", upstreamTaskId: null });
    });
  });

  it("submits a dynamic race once and makes the first observed provider success READY", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "SUCCEEDED", videoUrl: "opaque-video-result-1", completedAt: new Date("2026-08-01T00:00:02.500Z"), traceId: null, safeErrorCode: null }],
        ALIBABA_EMO: [{ status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null }]
      });
      const repository = createPrismaRenderRepository(prisma, { makeClaimToken: sequence("claim") });
      const orchestrator = createRenderOrchestrator({
        repository,
        resolveProfile: async (id) => id === "profile-primary"
          ? { id, displayName: "Primary", portraitAssetId: "portrait-asset", enabled: true }
          : { id, displayName: "Secondary", portraitAssetId: "portrait-secondary", enabled: true },
        resolveVideoModel: async (id, kind) => ({
          modelId: id,
          providerId: kind === "LINGMOU_BROADCAST" ? "provider-lingmou" : "provider-emo",
          provider: providers[kind],
          requiresPortrait: true
        }),
        loadAsset: async (id) => {
          const asset = await prisma.digitalHumanMediaAsset.findUniqueOrThrow({ where: { id } });
          return asset;
        },
        createReadUrl: async (asset) => {
          calls.signed.push(asset.id);
          return `opaque-read-handle-${asset.id}`;
        },
        cacheOutput: async ({ attemptId }) => {
          const id = `video-${attemptId}`;
          await prisma.digitalHumanMediaAsset.create({ data: {
            id, storageConfigId: "storage-1", objectKey: `output-${attemptId}`,
            mimeType: "video/mp4", byteLength: 200, purpose: "VIDEO_OUTPUT", updatedAt: new Date()
          } });
          return { assetId: id };
        },
        discardCachedOutput: async () => undefined,
        encryptOutputUrl: (url) => ({ ciphertext: Buffer.from(url).toString("base64"), iv: "safe-iv", tag: "safe-tag" }),
        decryptOutputUrl: (envelope) => Buffer.from(envelope.ciphertext, "base64").toString("utf8")
      });
      const input = orchestratorInput("DYNAMIC");

      const first = await orchestrator.startDynamicRace(input);
      const duplicate = await orchestrator.startDynamicRace(input);
      expect(first.id).toBe(duplicate.id);
      expect(first.status).toBe("RACING");
      expect(calls.submit.sort()).toEqual(["ALIBABA_EMO", "LINGMOU_BROADCAST"]);
      expect(calls.signed).toHaveLength(4);
      expect(JSON.stringify(first)).not.toMatch(/signed\.invalid|audio-object|portrait-object/i);

      const ready = await orchestrator.advance(first.id, new Date("2026-08-01T00:00:03.000Z"));
      expect(ready).toMatchObject({
        status: "READY",
        winnerProvider: "LINGMOU_BROADCAST",
        winnerInterviewer: "Primary"
      });
      expect(calls.query).toEqual(["LINGMOU_BROADCAST"]);
      expect(await prisma.digitalHumanRenderJob.findUnique({ where: { id: first.id } }))
        .toMatchObject({ status: "READY", winnerAttemptId: expect.any(String) });
    });
  });

  it("keeps preset EMO dormant until an explicit terminal Lingmou failure", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "FAILED", videoUrl: null, completedAt: new Date("2026-08-01T00:00:02.000Z"), traceId: null, safeErrorCode: "LINGMOU_BROADCAST_UPSTREAM_FAILED" }],
        ALIBABA_EMO: []
      });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.ensurePresetJob(orchestratorInput("PRESET"));
      expect(initial.status).toBe("SUBMITTED");
      expect(calls.submit).toEqual(["LINGMOU_BROADCAST"]);
      expect(await prisma.digitalHumanRenderAttempt.count({ where: { renderJobId: initial.id } })).toBe(2);

      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));
      expect(calls.submit).toEqual(["LINGMOU_BROADCAST", "ALIBABA_EMO"]);
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: initial.id, providerKind: "ALIBABA_EMO" } }
      })).toMatchObject({ status: "SUBMITTED", upstreamTaskId: "task-ALIBABA_EMO" });
    });
  });

  it("atomically falls back at exactly 8 seconds and caches the boundary success as late", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [
          { status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null },
          { status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null }
        ],
        ALIBABA_EMO: [{ status: "SUCCEEDED", videoUrl: "opaque-video-result-late", completedAt: new Date("2026-08-01T00:00:07.000Z"), traceId: null, safeErrorCode: null }]
      });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:06.000Z"));
      const fallback = await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:08.000Z"));

      expect(fallback).toMatchObject({ status: "FALLBACK", winnerProvider: null, winnerAssetId: null });
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: initial.id, providerKind: "ALIBABA_EMO" } }
      })).toMatchObject({ status: "SUCCEEDED", outputAssetId: expect.any(String) });
      await orchestrator.collectLateResults(initial.id, new Date("2026-08-01T00:00:09.000Z"));
      expect((await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:09.000Z"))).status).toBe("FALLBACK");
    });
  });

  it("lets concurrent advance calls claim one provider query and one cache operation", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "SUCCEEDED", videoUrl: "opaque-video-result-once", completedAt: null, traceId: null, safeErrorCode: null }],
        ALIBABA_EMO: []
      });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      await Promise.all([
        orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z")),
        orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"))
      ]);
      expect(calls.query).toEqual(["LINGMOU_BROADCAST"]);
      expect(await prisma.digitalHumanMediaAsset.count({ where: { purpose: "VIDEO_OUTPUT" } })).toBe(1);
    });
  });

  it("rejects expired internal assets before signing or provider calls", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      await prisma.digitalHumanMediaAsset.update({
        where: { id: "audio-asset" }, data: { expiresAt: new Date("2026-07-31T23:59:59.000Z") }
      });
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      const orchestrator = testOrchestrator(prisma, calls, providers);

      await expect(orchestrator.startDynamicRace(orchestratorInput("DYNAMIC")))
        .rejects.toMatchObject({ code: "VIDEO_TTS_AUDIO_ASSET_INVALID" });
      expect(calls).toEqual({ submit: [], query: [], signed: [] });
      expect(await prisma.digitalHumanRenderJob.count()).toBe(0);
    });
  });

  it("caches a late loser after READY without replacing the immutable winner", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "SUCCEEDED", videoUrl: "opaque-video-result-winner", completedAt: null, traceId: null, safeErrorCode: null }],
        ALIBABA_EMO: [{ status: "SUCCEEDED", videoUrl: "opaque-video-result-loser", completedAt: null, traceId: null, safeErrorCode: null }]
      });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      const winner = await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));
      await orchestrator.collectLateResults(initial.id, new Date("2026-08-01T00:00:08.000Z"));
      const unchanged = await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:09.000Z"));

      expect(unchanged.winnerProvider).toBe("LINGMOU_BROADCAST");
      expect(unchanged.winnerAssetId).toBe(winner.winnerAssetId);
      expect(await prisma.digitalHumanMediaAsset.count({ where: { purpose: "VIDEO_OUTPUT" } })).toBe(2);
    });
  });

  it("rejects an incomplete provider profile mapping before creating a job or calling providers", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      const orchestrator = createRenderOrchestrator({
        ...testDependencies(prisma, calls, providers),
        resolveVideoModel: async (id, kind) => ({
          modelId: id,
          providerId: kind === "LINGMOU_BROADCAST" ? "provider-lingmou" : "provider-emo",
          provider: providers[kind],
          requiresPortrait: true,
          validateProfile() {
            throw new MediaConfigurationError("Profile mapping is incomplete", {
              code: "VIDEO_PROFILE_NOT_CONFIGURED"
            });
          }
        })
      });

      await expect(orchestrator.startDynamicRace(orchestratorInput("DYNAMIC")))
        .rejects.toMatchObject({ code: "VIDEO_PROFILE_NOT_CONFIGURED" });
      expect(calls).toEqual({ submit: [], query: [], signed: [] });
      expect(await prisma.digitalHumanRenderJob.count()).toBe(0);
    });
  });

  it("rejects a conflicting idempotency plan without submitting another provider", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const original = orchestratorInput("PRESET");
      await orchestrator.ensurePresetJob(original);
      const submissionsBeforeConflict = [...calls.submit];

      await expect(orchestrator.ensurePresetJob({
        ...original,
        runtimeSettings: { ...original.runtimeSettings, mode: "EMO_ONLY" }
      })).rejects.toMatchObject({ code: "VIDEO_RENDER_IDEMPOTENCY_CONFLICT" });
      expect(calls.submit).toEqual(submissionsBeforeConflict);
      expect(await prisma.digitalHumanRenderJob.count()).toBe(1);
    });
  });

  it("keeps Lingmou and EMO RUNNING attempts eligible for explicit late collection", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [
          { status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null },
          { status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null },
          { status: "SUCCEEDED", videoUrl: "opaque-lingmou-late", completedAt: null, traceId: null, safeErrorCode: null }
        ],
        ALIBABA_EMO: [
          { status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null },
          { status: "SUCCEEDED", videoUrl: "opaque-emo-late", completedAt: null, traceId: null, safeErrorCode: null }
        ]
      });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:06.000Z"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:08.000Z"));
      await orchestrator.collectLateResults(initial.id, new Date("2026-08-01T00:00:09.000Z"));
      await orchestrator.collectLateResults(initial.id, new Date("2026-08-01T00:00:11.000Z"));

      const attempts = await prisma.digitalHumanRenderAttempt.findMany({ where: { renderJobId: initial.id } });
      expect(attempts).toEqual(expect.arrayContaining([
        expect.objectContaining({ providerKind: "LINGMOU_BROADCAST", status: "SUCCEEDED", outputAssetId: expect.any(String) }),
        expect.objectContaining({ providerKind: "ALIBABA_EMO", status: "SUCCEEDED", outputAssetId: expect.any(String) })
      ]));
      expect((await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:12.000Z"))).status).toBe("FALLBACK");
    });
  });

  it("releases a retryable query failure without activating preset EMO", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      providers.LINGMOU_BROADCAST.query = async () => {
        calls.query.push("LINGMOU_BROADCAST");
        throw new MediaProviderError("raw transport detail", "LINGMOU", "LINGMOU_BROADCAST_UPSTREAM_FAILED", true);
      };
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.ensurePresetJob(orchestratorInput("PRESET"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));

      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: initial.id, providerKind: "LINGMOU_BROADCAST" } }
      })).toMatchObject({
        status: "RUNNING",
        failureKind: "RETRYABLE_QUERY",
        nextPollAt: new Date("2026-08-01T00:00:06.000Z")
      });
      expect(calls.submit).toEqual(["LINGMOU_BROADCAST"]);
    });
  });

  it("retries a transient cache failure from OUTPUT_PENDING without claiming READY", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "SUCCEEDED", videoUrl: "opaque-cache-retry", completedAt: null, traceId: null, safeErrorCode: null }],
        ALIBABA_EMO: []
      });
      let cacheCalls = 0;
      const dependencies = testDependencies(prisma, calls, providers);
      const orchestrator = createRenderOrchestrator({
        ...dependencies,
        cacheOutput: async (input) => {
          cacheCalls += 1;
          if (cacheCalls === 1) throw new Error("transient private storage failure");
          return dependencies.cacheOutput(input);
        }
      });
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      const pending = await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));
      expect(pending.status).not.toBe("READY");
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: initial.id, providerKind: "LINGMOU_BROADCAST" } }
      })).toMatchObject({
        status: "OUTPUT_PENDING",
        failureKind: "RETRYABLE_CACHE",
        nextPollAt: new Date("2026-08-01T00:00:06.000Z")
      });

      const ready = await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:06.000Z"));
      expect(ready).toMatchObject({ status: "READY", winnerProvider: "LINGMOU_BROADCAST" });
      expect(cacheCalls).toBe(2);
    });
  });

  it("compensates an unattached cache asset when completeCache loses ownership", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "SUCCEEDED", videoUrl: "opaque-cache-cas", completedAt: null, traceId: null, safeErrorCode: null }],
        ALIBABA_EMO: []
      });
      const base = createPrismaRenderRepository(prisma, { makeClaimToken: sequence("claim") });
      const discarded: string[] = [];
      const dependencies = testDependencies(prisma, calls, providers);
      const orchestrator = createRenderOrchestrator({
        ...dependencies,
        repository: { ...base, completeCache: async () => false },
        discardCachedOutput: async ({ assetId }) => {
          discarded.push(assetId);
          await prisma.digitalHumanMediaAsset.delete({ where: { id: assetId } });
        }
      });
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      const result = await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));

      expect(result.status).not.toBe("READY");
      expect(discarded).toHaveLength(1);
      expect(await prisma.digitalHumanMediaAsset.count({ where: { purpose: "VIDEO_OUTPUT" } })).toBe(0);
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: initial.id, providerKind: "LINGMOU_BROADCAST" } }
      })).toMatchObject({ status: "OUTPUT_PENDING", outputAssetId: null, failureKind: "RETRYABLE_CACHE" });
    });
  });

  it("compensates a cache asset when the database attach transaction fails", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, {
        LINGMOU_BROADCAST: [{ status: "SUCCEEDED", videoUrl: "opaque-cache-db-failure", completedAt: null, traceId: null, safeErrorCode: null }],
        ALIBABA_EMO: []
      });
      const base = createPrismaRenderRepository(prisma, { makeClaimToken: sequence("claim") });
      const discarded: string[] = [];
      const dependencies = testDependencies(prisma, calls, providers);
      const orchestrator = createRenderOrchestrator({
        ...dependencies,
        repository: {
          ...base,
          completeCache: async () => {
            throw new Error("database attach transaction unavailable");
          }
        },
        discardCachedOutput: async ({ assetId }) => {
          discarded.push(assetId);
          await prisma.digitalHumanMediaAsset.delete({ where: { id: assetId } });
        }
      });
      const initial = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));

      expect(discarded).toHaveLength(1);
      expect(await prisma.digitalHumanMediaAsset.count({ where: { purpose: "VIDEO_OUTPUT" } })).toBe(0);
      expect(await prisma.digitalHumanRenderAttempt.findUnique({
        where: { renderJobId_providerKind: { renderJobId: initial.id, providerKind: "LINGMOU_BROADCAST" } }
      })).toMatchObject({ status: "OUTPUT_PENDING", outputAssetId: null, failureKind: "RETRYABLE_CACHE" });
    });
  });

  it("persists provider-only and synchronized profile plans exactly", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const lingInput = orchestratorInput("DYNAMIC");
      lingInput.runtimeSettings.mode = "LINGMOU_ONLY";
      const ling = await orchestrator.startDynamicRace(lingInput);
      const emoInput = {
        ...orchestratorInput("DYNAMIC"),
        questionId: "question-emo-only",
        questionHash: "hash-emo-only",
        cacheKey: "cache-emo-only",
        runtimeSettings: { ...runtimeSettings(), mode: "EMO_ONLY" as const }
      };
      const emo = await orchestrator.startDynamicRace(emoInput);
      const syncInput = {
        ...orchestratorInput("DYNAMIC"),
        questionId: "question-sync",
        questionHash: "hash-sync",
        cacheKey: "cache-sync",
        runtimeSettings: { ...runtimeSettings(), synchronizeProfiles: true, secondaryProfileId: null }
      };
      const sync = await orchestrator.startDynamicRace(syncInput);

      expect(await prisma.digitalHumanRenderAttempt.findMany({ where: { renderJobId: ling.id }, select: { providerKind: true } }))
        .toEqual([{ providerKind: "LINGMOU_BROADCAST" }]);
      expect(await prisma.digitalHumanRenderAttempt.findMany({ where: { renderJobId: emo.id }, select: { providerKind: true, interviewerProfileId: true } }))
        .toEqual([{ providerKind: "ALIBABA_EMO", interviewerProfileId: "profile-secondary" }]);
      expect(await prisma.digitalHumanRenderAttempt.findMany({ where: { renderJobId: sync.id }, select: { interviewerProfileId: true } }))
        .toEqual([
          { interviewerProfileId: "profile-primary" },
          { interviewerProfileId: "profile-primary" }
        ]);
    });
  });

  it("revalidates persisted models immediately before submission and makes zero paid calls when stale", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      const dependencies = testDependencies(prisma, calls, providers);
      let resolutions = 0;
      const orchestrator = createRenderOrchestrator({
        ...dependencies,
        resolveVideoModel: async (id, kind) => {
          resolutions += 1;
          const resolved = await dependencies.resolveVideoModel(id, kind);
          return resolutions > 2 ? { ...resolved, providerId: `stale-${resolved.providerId}` } : resolved;
        }
      });
      const snapshot = await orchestrator.startDynamicRace(orchestratorInput("DYNAMIC"));

      expect(calls).toEqual({ submit: [], query: [], signed: [] });
      expect(await prisma.digitalHumanRenderAttempt.findMany({ where: { renderJobId: snapshot.id }, select: { status: true, failureKind: true, safeErrorCode: true } }))
        .toEqual([
          { status: "FAILED", failureKind: "CONFIGURATION", safeErrorCode: "VIDEO_MODEL_STALE" },
          { status: "FAILED", failureKind: "CONFIGURATION", safeErrorCode: "VIDEO_MODEL_STALE" }
        ]);
    });
  });

  it("collapses raw provider exceptions to finite database codes without activating preset EMO", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedRenderParents(prisma);
      await seedSecondProviderProfile(prisma);
      const calls = { submit: [] as string[], query: [] as string[], signed: [] as string[] };
      const providers = providerBoundaries(calls, { LINGMOU_BROADCAST: [], ALIBABA_EMO: [] });
      providers.LINGMOU_BROADCAST.query = async () => {
        throw new Error("raw-provider-secret-and-private-handle");
      };
      const orchestrator = testOrchestrator(prisma, calls, providers);
      const initial = await orchestrator.ensurePresetJob(orchestratorInput("PRESET"));
      await orchestrator.advance(initial.id, new Date("2026-08-01T00:00:03.000Z"));
      const attempts = await prisma.digitalHumanRenderAttempt.findMany({ where: { renderJobId: initial.id } });

      expect(attempts.find((attempt) => attempt.providerKind === "LINGMOU_BROADCAST"))
        .toMatchObject({ status: "FAILED", failureKind: "PROVIDER_EXCEPTION", safeErrorCode: "VIDEO_PROVIDER_FAILED" });
      expect(attempts.find((attempt) => attempt.providerKind === "ALIBABA_EMO"))
        .toMatchObject({ status: "PENDING", upstreamTaskId: null });
      expect(JSON.stringify(attempts)).not.toContain("raw-provider-secret");
    });
  });
});

function orchestratorInput(kind: "PRESET" | "DYNAMIC") {
  const createdAt = new Date("2026-08-01T00:00:00.000Z");
  return {
    trainingSessionId: "session-1",
    questionId: `question-${kind.toLowerCase()}`,
    questionHash: `hash-${kind.toLowerCase()}`,
    cacheKey: `cache-${kind.toLowerCase()}`,
    kind,
    audioAssetId: "audio-asset",
    createdAt,
    deadlineAt: new Date(createdAt.getTime() + 8000),
    runtimeSettings: runtimeSettings()
  };
}

function runtimeSettings(): DigitalHumanVideoRuntimeSettings {
  return {
    mode: "AUTO_RACE", maxWaitMs: 8000, lingmouPollMs: [3000, 6000], emoPollMs: [8000],
    synchronizeProfiles: false, primaryProfileId: "profile-primary", secondaryProfileId: "profile-secondary",
    lingmouModelId: "model-lingmou", emoModelId: "model-emo"
  };
}

function providerBoundaries(
  calls: { submit: string[]; query: string[] },
  results: Record<"LINGMOU_BROADCAST" | "ALIBABA_EMO", Array<Awaited<ReturnType<AsyncAvatarVideoProvider["query"]>>>>
) {
  return Object.fromEntries((["LINGMOU_BROADCAST", "ALIBABA_EMO"] as const).map((kind) => [kind, {
    async submit() {
      calls.submit.push(kind);
      return { upstreamTaskId: `task-${kind}`, traceId: null };
    },
    async query() {
      calls.query.push(kind);
      return results[kind].shift() ?? { status: "RUNNING", videoUrl: null, completedAt: null, traceId: null, safeErrorCode: null };
    }
  } satisfies AsyncAvatarVideoProvider])) as Record<"LINGMOU_BROADCAST" | "ALIBABA_EMO", AsyncAvatarVideoProvider>;
}

function testOrchestrator(
  prisma: PrismaClient,
  calls: { submit: string[]; query: string[]; signed: string[] },
  providers: Record<"LINGMOU_BROADCAST" | "ALIBABA_EMO", AsyncAvatarVideoProvider>
) {
  return createRenderOrchestrator(testDependencies(prisma, calls, providers));
}

function testDependencies(
  prisma: PrismaClient,
  calls: { submit: string[]; query: string[]; signed: string[] },
  providers: Record<"LINGMOU_BROADCAST" | "ALIBABA_EMO", AsyncAvatarVideoProvider>
) {
  return {
    repository: createPrismaRenderRepository(prisma, { makeClaimToken: sequence("claim") }),
    resolveProfile: async (id) => id === "profile-primary"
      ? { id, displayName: "Primary", portraitAssetId: "portrait-asset", enabled: true }
      : { id, displayName: "Secondary", portraitAssetId: "portrait-secondary", enabled: true },
    resolveVideoModel: async (id, kind) => ({
      modelId: id,
      providerId: kind === "LINGMOU_BROADCAST" ? "provider-lingmou" : "provider-emo",
      provider: providers[kind],
      requiresPortrait: true
    }),
    loadAsset: (id) => prisma.digitalHumanMediaAsset.findUnique({ where: { id } }),
    createReadUrl: async (asset) => {
      calls.signed.push(asset.id);
      return `opaque-read-handle-${asset.id}`;
    },
    cacheOutput: async ({ attemptId }) => {
      const id = `video-${attemptId}`;
      await prisma.digitalHumanMediaAsset.create({ data: {
        id, storageConfigId: "storage-1", objectKey: `output-${attemptId}`,
        mimeType: "video/mp4", byteLength: 200, purpose: "VIDEO_OUTPUT", updatedAt: new Date()
      } });
      return { assetId: id };
    },
    discardCachedOutput: async () => undefined,
    encryptOutputUrl: (url) => ({ ciphertext: Buffer.from(url).toString("base64"), iv: "safe-iv", tag: "safe-tag" }),
    decryptOutputUrl: (envelope) => Buffer.from(envelope.ciphertext, "base64").toString("utf8")
  };
}

async function seedSecondProviderProfile(prisma: PrismaClient) {
  await prisma.digitalHumanMediaAsset.create({ data: {
    id: "portrait-secondary", storageConfigId: "storage-1", objectKey: "portrait-secondary-object",
    mimeType: "image/png", byteLength: 100, purpose: "PORTRAIT", updatedAt: new Date()
  } });
  await prisma.interviewerAvatarProfile.create({ data: {
    id: "profile-secondary", displayName: "Secondary", voice: "voice-2", styleJson: "{}",
    portraitAssetId: "portrait-secondary", lingmouMappingJson: "{}", emoMappingJson: "{}",
    providerRole: "SECONDARY", updatedAt: new Date()
  } });
}

function renderInput(createdAt = new Date("2026-08-01T00:00:00.000Z")) {
  return {
    trainingSessionId: "session-1",
    questionId: "question-1",
    questionHash: "hash-1",
    cacheKey: "cache-1",
    kind: "PRESET" as const,
    mode: "AUTO_RACE" as const,
    interviewerProfileId: "profile-primary",
    audioAssetId: "audio-asset",
    createdAt,
    deadlineAt: new Date(createdAt.getTime() + 8000),
    planFingerprint: "plan-fingerprint-1",
    attempts: [{
      providerKind: "LINGMOU_BROADCAST" as const,
      providerId: "provider-lingmou",
      modelId: "model-lingmou",
      interviewerProfileId: "profile-primary",
      interviewerName: "Primary",
      portraitAssetId: "portrait-asset"
    }]
  };
}

async function seedRenderParents(prisma: PrismaClient) {
  await prisma.candidate.create({ data: { id: "candidate-1", name: "Candidate" } });
  await prisma.trainingTask.create({ data: {
    id: "task-1", candidateId: "candidate-1", title: "Interview",
    targetCompany: "Company", targetRole: "Engineer", stageConfig: "[]", expectedMinutes: 30
  } });
  await prisma.trainingSession.create({ data: {
    id: "session-1", taskId: "task-1", candidateId: "candidate-1"
  } });
  await prisma.mediaStorageConfig.create({ data: {
    id: "storage-1", displayName: "Private", providerKind: "ALI_OSS",
    endpoint: "oss.example.invalid", bucket: "private-bucket", updatedAt: new Date()
  } });
  await prisma.digitalHumanMediaAsset.createMany({ data: [
    { id: "audio-asset", storageConfigId: "storage-1", objectKey: "audio-object", mimeType: "audio/wav", byteLength: 100, purpose: "TTS_AUDIO", updatedAt: new Date() },
    { id: "portrait-asset", storageConfigId: "storage-1", objectKey: "portrait-object", mimeType: "image/png", byteLength: 100, purpose: "PORTRAIT", updatedAt: new Date() }
  ] });
  await prisma.interviewerAvatarProfile.create({ data: {
    id: "profile-primary", displayName: "Primary", voice: "voice-1",
    styleJson: "{}", portraitAssetId: "portrait-asset", lingmouMappingJson: "{}",
    emoMappingJson: "{}", providerRole: "PRIMARY", updatedAt: new Date()
  } });
}

function sequence(prefix: string) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

async function withTemporaryPrisma(run: (prisma: PrismaClient) => Promise<void>) {
  const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".video-render-"));
  const databaseUrl = `file:./${basename(temporaryDirectory)}/service.db`;
  let prisma: PrismaClient | undefined;
  try {
    const setupPath = join(temporaryDirectory, "setup.sql");
    const sql = readdirSync(migrationsDirectory)
      .filter((directory) => /^\d/.test(directory))
      .sort()
      .map((directory) => readFileSync(join(migrationsDirectory, directory, "migration.sql"), "utf8"))
      .join("\n");
    writeFileSync(setupPath, sql, "utf8");
    execFileSync(process.execPath, [prismaCliPath, "db", "execute", "--file", setupPath, "--url", databaseUrl], {
      cwd: prismaDirectory,
      stdio: "pipe"
    });
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await run(prisma);
  } finally {
    try {
      await prisma?.$disconnect();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

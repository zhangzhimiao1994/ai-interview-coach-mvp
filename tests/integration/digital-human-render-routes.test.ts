import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createAdminSessionCookie } from "@/lib/security/adminSession";
import { persistAnswerWithDynamicPlaceholder, persistSessionWithRenderPlaceholders } from "@/lib/media/video/sessionPlaceholders";
import { buildDynamicRenderPlaceholder } from "@/lib/media/video/renderRequests";
import type { TrainingOutline } from "@/lib/ai";
import {
  createCandidateSessionCookie,
  verifyCandidateSessionCookie
} from "@/lib/security/candidateSession";
import {
  createSafeRenderResponse,
  parseBoundedRange,
  providerDisplayLabel
} from "@/lib/media/video/renderApi";
import {
  parseCreateRenderRequest,
  parsePrewarmRenderRequest
} from "@/lib/validators/digitalHumanRender";

const secret = "task-eight-test-secret-that-is-long-enough";

describe("secure digital-human render route contracts", () => {
  it("binds candidate capability cookies to one candidate session and rejects tampering or expiry", async () => {
    const cookie = await createCandidateSessionCookie(
      { trainingSessionId: "session-a", candidateId: "candidate-a" },
      secret,
      1_000,
      100
    );
    await expect(verifyCandidateSessionCookie(cookie, secret, 1_099)).resolves.toEqual({
      ok: true,
      session: { trainingSessionId: "session-a", candidateId: "candidate-a" }
    });
    await expect(verifyCandidateSessionCookie(`${cookie}x`, secret, 1_099)).resolves.toEqual({ ok: false });
    await expect(verifyCandidateSessionCookie(`${cookie}.ignored`, secret, 1_099)).resolves.toEqual({ ok: false });
    await expect(verifyCandidateSessionCookie(cookie, secret, 1_100)).resolves.toEqual({ ok: false });
  });

  it("accepts only server-authoritative request identifiers", () => {
    expect(parseCreateRenderRequest({
      sessionId: "session-a",
      questionId: "question-a",
      kind: "PRESET"
    })).toEqual({ sessionId: "session-a", questionId: "question-a", kind: "PRESET" });
    expect(() => parseCreateRenderRequest({
      sessionId: "session-a",
      questionId: "question-a",
      kind: "PRESET",
      providerId: "attacker-provider"
    })).toThrow();
    expect(() => parsePrewarmRenderRequest({
      sessionId: "session-a",
      currentQuestionId: "question-a",
      nextQuestionId: "attacker-choice"
    })).toThrow();
  });

  it("returns finite safe snapshots and a project-owned playback URL only for READY", () => {
    expect(providerDisplayLabel("LINGMOU_BROADCAST")).toBe("灵眸播报");
    expect(providerDisplayLabel("ALIBABA_EMO")).toBe("阿里云 EMO");
    const pending = createSafeRenderResponse({
      id: "placeholder-a",
      status: "SUBMITTED",
      deadlineAt: new Date(8_000),
      createdAt: new Date(0),
      winnerProvider: null,
      winnerInterviewer: null,
      fallbackReason: null
    }, new Date(3_000));
    expect(pending.playbackUrl).toBeUndefined();

    const ready = createSafeRenderResponse({
      id: "placeholder-a",
      status: "READY",
      deadlineAt: new Date(8_000),
      createdAt: new Date(0),
      winnerProvider: "ALIBABA_EMO",
      winnerInterviewer: "Interviewer A",
      fallbackReason: null
    }, new Date(4_000));
    expect(ready).toMatchObject({
      renderId: "placeholder-a",
      providerLabel: providerDisplayLabel("ALIBABA_EMO"),
      playbackUrl: "/api/digital-human/renders/placeholder-a?playback=1"
    });
    expect(JSON.stringify(ready)).not.toMatch(/accesskey|api[_-]?key|authorization|signed\.|objectKey|upstreamTaskId|rawResponse/i);
  });

  it("bounds media range requests", () => {
    expect(parseBoundedRange("bytes=0-1023", 5_000)).toEqual({ start: 0, end: 1023 });
    expect(parseBoundedRange("bytes=4500-", 5_000)).toEqual({ start: 4500, end: 4999 });
    expect(parseBoundedRange("bytes=0-99999999", 5_000)).toEqual({ start: 0, end: 4999 });
    expect(parseBoundedRange("bytes=-100", 5_000)).toBeNull();
    expect(parseBoundedRange("bytes=0-1,3-4", 5_000)).toBeNull();
    expect(parseBoundedRange("bytes=0-999999999", 999_999_999)).toEqual({ start: 0, end: 8 * 1024 * 1024 - 1 });
  });
});

describe("actual render HTTP handlers with migrated SQLite", () => {
  let directory = "";
  let client: PrismaClient;
  let routes: {
    item: typeof import("@/app/api/digital-human/renders/[renderId]/route");
    prewarm: typeof import("@/app/api/digital-human/renders/prewarm/route");
    root: typeof import("@/app/api/digital-human/renders/route");
    handlers: typeof import("@/lib/media/video/renderRouteHandlers");
    service: typeof import("@/lib/media/video/renderService");
  };

  beforeAll(async () => {
    const prismaDirectory = join(process.cwd(), "prisma");
    directory = mkdtempSync(join(prismaDirectory, ".render-routes-"));
    const databaseUrl = `file:./${basename(directory)}/routes.db`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.AI_CONFIG_SECRET = secret;
    const setupPath = join(directory, "setup.sql");
    const sql = readdirSync(join(prismaDirectory, "migrations"))
      .filter((name) => /^\d/.test(name))
      .sort()
      .map((name) => readFileSync(join(prismaDirectory, "migrations", name, "migration.sql"), "utf8"))
      .join("\n");
    writeFileSync(setupPath, sql, "utf8");
    execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "execute", "--file", setupPath, "--url", databaseUrl], {
      cwd: prismaDirectory,
      stdio: "pipe"
    });
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await seedSessions(client);
    routes = {
      item: await import("@/app/api/digital-human/renders/[renderId]/route"),
      prewarm: await import("@/app/api/digital-human/renders/prewarm/route"),
      root: await import("@/app/api/digital-human/renders/route"),
      handlers: await import("@/lib/media/video/renderRouteHandlers"),
      service: await import("@/lib/media/video/renderService")
    };
  }, 30_000);

  afterAll(async () => {
    await client?.$disconnect();
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("denies candidate A access to candidate B query and prewarm", async () => {
    const cookie = await createCandidateSessionCookie({
      trainingSessionId: "session-a",
      candidateId: "candidate-a"
    }, secret);
    const headers = { cookie: `aic_candidate_session=${cookie}`, "content-type": "application/json" };
    const getResponse = await routes.item.GET(
      new Request("http://localhost/api/digital-human/renders/render-b", { headers }),
      { params: Promise.resolve({ renderId: "render-b" }) }
    );
    expect(getResponse.status).toBe(403);
    const prewarmResponse = await routes.prewarm.POST(new Request(
      "http://localhost/api/digital-human/renders/prewarm",
      { method: "POST", headers, body: JSON.stringify({ sessionId: "session-b", currentQuestionId: "q-b" }) }
    ));
    expect(prewarmResponse.status).toBe(403);
    const playbackResponse = await routes.item.GET(
      new Request("http://localhost/api/digital-human/renders/render-b?playback=1", { headers }),
      { params: Promise.resolve({ renderId: "render-b" }) }
    );
    expect(playbackResponse.status).toBe(403);
  });

  it("invokes the actual POST handler with strict input and idempotently reuses the placeholder", async () => {
    const cookie = await createCandidateSessionCookie({ trainingSessionId: "session-a", candidateId: "candidate-a" }, secret);
    const request = (body: unknown) => routes.root.POST(new Request("http://localhost/api/digital-human/renders", {
      method: "POST",
      headers: { cookie: `aic_candidate_session=${cookie}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }));
    expect((await request({ sessionId: "session-a", questionId: "q-a", kind: "PRESET", providerId: "forged" })).status).toBe(400);
    const first = await request({ sessionId: "session-a", questionId: "q-a", kind: "PRESET" });
    const second = await request({ sessionId: "session-a", questionId: "q-a", kind: "PRESET" });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((await first.json()).renderId).toBe((await second.json()).renderId);
    expect(await client.digitalHumanRenderPlaceholder.count({ where: { trainingSessionId: "session-a" } })).toBe(1);
  });

  it("returns safe local fallback without media/provider rows when runtime is unconfigured", async () => {
    const cookie = await createCandidateSessionCookie({
      trainingSessionId: "session-a",
      candidateId: "candidate-a"
    }, secret);
    const response = await routes.prewarm.POST(new Request(
      "http://localhost/api/digital-human/renders/prewarm",
      {
        method: "POST",
        headers: { cookie: `aic_candidate_session=${cookie}`, "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-a", currentQuestionId: "q-a" })
      }
    ));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.renders[0]).toMatchObject({ status: "FALLBACK", fallback: { active: true, reason: "VIDEO_RUNTIME_NOT_CONFIGURED" } });
    expect(JSON.stringify(body)).not.toMatch(/objectKey|upstreamTaskId|authorization|signed\.|accessKey/i);
    expect(await client.digitalHumanMediaAsset.count()).toBe(0);
    expect(await client.digitalHumanRenderAttempt.count()).toBe(0);
  });

  it("makes expired synthesis ambiguous terminal without replaying TTS", async () => {
    await client.digitalHumanRenderPlaceholder.update({
      where: { id: "render-b" },
      data: { status: "SYNTHESIZING", claimToken: "stale", claimExpiresAt: new Date(0) }
    });
    const cookie = await createCandidateSessionCookie({ trainingSessionId: "session-b", candidateId: "candidate-b" }, secret);
    const request = () => routes.item.GET(
      new Request("http://localhost/api/digital-human/renders/render-b", { headers: { cookie: `aic_candidate_session=${cookie}` } }),
      { params: Promise.resolve({ renderId: "render-b" }) }
    );
    const [first, second] = await Promise.all([request(), request()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await client.digitalHumanRenderPlaceholder.findUnique({ where: { id: "render-b" } }))
      .toMatchObject({ status: "FALLBACK", fallbackReason: "VIDEO_SPEECH_SUBMISSION_AMBIGUOUS", audioAssetId: null });
    expect(await client.digitalHumanMediaAsset.count()).toBe(0);
    expect(await client.digitalHumanRenderJob.count()).toBe(0);
  });

  it("allows diagnostics only for a verified admin and keeps them finite", async () => {
    const candidateCookie = await createCandidateSessionCookie({ trainingSessionId: "session-a", candidateId: "candidate-a" }, secret);
    const candidate = await routes.item.GET(
      new Request("http://localhost/api/digital-human/renders/render-a?diagnostics=1", {
        headers: { cookie: `aic_candidate_session=${candidateCookie}` }
      }),
      { params: Promise.resolve({ renderId: "render-a" }) }
    );
    expect(candidate.status).toBe(403);

    const adminCookie = await createAdminSessionCookie({
      subject: "admin-1",
      username: "admin",
      source: "database"
    }, secret);
    const admin = await routes.item.GET(
      new Request("http://localhost/api/digital-human/renders/render-a?diagnostics=1", {
        headers: { cookie: `aic_admin_session=${adminCookie}` }
      }),
      { params: Promise.resolve({ renderId: "render-a" }) }
    );
    expect(admin.status).toBe(200);
    expect(JSON.stringify(await admin.json())).not.toMatch(/upstreamTaskId|objectKey|ciphertext|signed\.|apiKey/i);
  });

  it("proxies READY playback through the project URL with a bounded range and no signed redirect", async () => {
    let observedUrl = "";
    let observedRange = "";
    const handler = routes.handlers.createRenderGetHandler({
      authenticate: async () => ({ type: "candidate" as const, trainingSessionId: "session-a", candidateId: "candidate-a" }),
      getRender: async () => ({}),
      loadPlayback: async () => ({
        byteLength: 100_000_000,
        mimeType: "video/mp4" as const,
        createUpstreamUrl: async () => "https://signed.example/private-secret"
      }),
      fetchUpstream: async (url, init) => {
        observedUrl = url;
        observedRange = new Headers(init.headers).get("range") ?? "";
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: { "content-type": "video/mp4" }
        });
      }
    });
    const response = await handler(new Request(
      "http://localhost/api/digital-human/renders/render-a?playback=1",
      { headers: { range: "bytes=0-99999999" } }
    ), { params: Promise.resolve({ renderId: "render-a" }) });
    expect(response.status).toBe(206);
    expect(observedUrl).toBe("https://signed.example/private-secret");
    expect(observedRange).toBe(`bytes=0-${8 * 1024 * 1024 - 1}`);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-range")).toBe(`bytes 0-${8 * 1024 * 1024 - 1}/100000000`);
    expect(JSON.stringify(Object.fromEntries(response.headers))).not.toContain("signed.example");
  });

  it("persists every outline placeholder atomically without touching any media/provider table", async () => {
    const outline: TrainingOutline = {
      title: "Two questions",
      targetRole: "Engineer",
      stages: ["WARM_UP", "FORMAL_INTERVIEW"],
      estimatedMinutes: 2,
      questions: [
        { id: "session-create-q1", stage: "WARM_UP" as const, prompt: "One?", expectedFocus: [], followUps: [], difficulty: "LOW" as const, timeLimitSeconds: 30 },
        { id: "session-create-q2", stage: "FORMAL_INTERVIEW" as const, prompt: "Two?", expectedFocus: [], followUps: [], difficulty: "MEDIUM" as const, timeLimitSeconds: 30 }
      ]
    };
    const session = await persistSessionWithRenderPlaceholders(client, {
      taskId: "task-a",
      candidateId: "candidate-a",
      currentStage: "WARM_UP",
      outline
    });
    const placeholders = await client.digitalHumanRenderPlaceholder.findMany({
      where: { trainingSessionId: session.id },
      orderBy: { questionId: "asc" }
    });
    expect(placeholders.map(({ questionId, status }) => ({ questionId, status }))).toEqual([
      { questionId: "session-create-q1", status: "PENDING" },
      { questionId: "session-create-q2", status: "PENDING" }
    ]);
    expect(await client.digitalHumanMediaAsset.count()).toBe(0);
    expect(await client.digitalHumanRenderJob.count()).toBe(0);
    expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
  });

  it("prewarms only current and next in outline order under concurrent duplicate requests", async () => {
    const outline: TrainingOutline = {
      title: "Three questions",
      targetRole: "Engineer",
      stages: ["WARM_UP"],
      estimatedMinutes: 3,
      questions: ["one", "two", "three"].map((word, index) => ({
        id: `ordered-${index + 1}`,
        stage: "WARM_UP",
        prompt: `${word}?`,
        expectedFocus: [],
        followUps: [],
        difficulty: "LOW",
        timeLimitSeconds: 30
      }))
    };
    const session = await persistSessionWithRenderPlaceholders(client, {
      taskId: "task-a",
      candidateId: "candidate-a",
      currentStage: "WARM_UP",
      outline
    });
    const cookie = await createCandidateSessionCookie({ trainingSessionId: session.id, candidateId: "candidate-a" }, secret);
    const invoke = () => routes.prewarm.POST(new Request("http://localhost/api/digital-human/renders/prewarm", {
      method: "POST",
      headers: { cookie: `aic_candidate_session=${cookie}`, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, currentQuestionId: "ordered-1" })
    }));
    const [first, second] = await Promise.all([invoke(), invoke()]);
    const firstBody = await first.json();
    const secondBody = await second.json();
    const expected = await client.digitalHumanRenderPlaceholder.findMany({
      where: { trainingSessionId: session.id, questionId: { in: ["ordered-1", "ordered-2"] } },
      orderBy: { questionId: "asc" }
    });
    expect(firstBody.renders.map((render: { renderId: string }) => render.renderId)).toEqual(expected.map(({ id }) => id));
    expect(secondBody.renders.map((render: { renderId: string }) => render.renderId)).toEqual(expected.map(({ id }) => id));
    expect(await client.digitalHumanRenderPlaceholder.findFirst({ where: { trainingSessionId: session.id, questionId: "ordered-3" } }))
      .toMatchObject({ status: "PENDING" });
    expect(await client.digitalHumanRenderJob.count({ where: { trainingSessionId: session.id } })).toBe(0);
  });

  it("atomically stores the exact generated dynamic follow-up and creates no nested unused placeholder", async () => {
    const exactText = "What exact metric changed?";
    const dynamic = buildDynamicRenderPlaceholder({
      trainingSessionId: "session-a",
      parentQuestionId: "q-a",
      stage: "WARM_UP",
      text: exactText
    });
    await persistAnswerWithDynamicPlaceholder(client, {
      sessionId: "session-a",
      questionId: "q-a",
      stage: "WARM_UP",
      question: "Question a",
      answer: "Answer",
      feedback: JSON.stringify({ followUpQuestion: exactText }),
      dynamicPlaceholder: dynamic
    });
    expect(await client.digitalHumanRenderPlaceholder.findFirst({
      where: { trainingSessionId: "session-a", questionId: "q-a::follow-up::1" }
    })).toMatchObject({ questionText: exactText, kind: "DYNAMIC" });
    await persistAnswerWithDynamicPlaceholder(client, {
      sessionId: "session-a",
      questionId: "q-a::follow-up::1",
      stage: "WARM_UP",
      question: exactText,
      answer: "More detail",
      feedback: JSON.stringify({ followUpQuestion: "unused" }),
      dynamicPlaceholder: null
    });
    expect(await client.digitalHumanRenderPlaceholder.count({
      where: { trainingSessionId: "session-a", questionId: { contains: "::follow-up::1::" } }
    })).toBe(0);
  });

  it("serializes concurrent configured materialization to one paid speech and provider plan", async () => {
    const settings = await seedConfiguredMaterialization(client, "single");
    let speechCalls = 0;
    let planCreations = 0;
    let releaseSpeech!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const speechGate = new Promise<void>((resolve) => { releaseSpeech = resolve; });
    const dependencies = {
      database: client,
      loadRuntimeSettings: async () => settings,
      createSpeechAsset: async () => {
        speechCalls += 1;
        signalStarted();
        await speechGate;
        return { assetId: "configured-audio-single", mimeType: "audio/wav" as const, byteLength: 100, sampleRate: 48_000, channels: 1 as const };
      },
      createOrchestrator: () => ({
        ensurePresetJob: async () => {
          planCreations += 1;
          return renderSnapshot("configured-job-single");
        },
        startDynamicRace: async () => renderSnapshot("configured-job-single"),
        advance: async () => renderSnapshot("configured-job-single"),
        collectLateResults: async () => undefined
      }),
      makeClaimToken: () => "configured-claim-single",
      now: () => new Date(0)
    };
    const first = routes.service.materializeRenderPlaceholder("configured-placeholder-single", new Date(0), dependencies);
    await started;
    const second = await routes.service.materializeRenderPlaceholder("configured-placeholder-single", new Date(1), dependencies);
    expect(second.status).toBe("SYNTHESIZING");
    releaseSpeech();
    await first;
    expect(speechCalls).toBe(1);
    expect(planCreations).toBe(1);
    expect(await client.digitalHumanRenderPlaceholder.findUnique({ where: { id: "configured-placeholder-single" } }))
      .toMatchObject({ status: "MATERIALIZED", renderJobId: "configured-job-single" });
  });

  it("uses claim-token CAS so a stale materializer cannot overwrite its successor", async () => {
    const settings = await seedConfiguredMaterialization(client, "cas", true);
    let calls = 0;
    let providerPlanCreations = 0;
    let releaseFirst!: () => void;
    let signalFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirst = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const seenPlans = new Set<string>();
    const dependencies = {
      database: client,
      loadRuntimeSettings: async () => settings,
      createSpeechAsset: async () => { throw new Error("must reuse attached audio"); },
      createOrchestrator: () => ({
        ensurePresetJob: async () => {
          calls += 1;
          if (!seenPlans.has("immutable-plan")) {
            seenPlans.add("immutable-plan");
            providerPlanCreations += 1;
          }
          if (calls === 1) {
            signalFirst();
            await firstGate;
          }
          return renderSnapshot("configured-job-cas");
        },
        startDynamicRace: async () => renderSnapshot("configured-job-cas"),
        advance: async () => renderSnapshot("configured-job-cas"),
        collectLateResults: async () => undefined
      }),
      makeClaimToken: (() => {
        let index = 0;
        return () => `cas-claim-${++index}`;
      })(),
      now: () => new Date(0)
    };
    const first = routes.service.materializeRenderPlaceholder("configured-placeholder-cas", new Date(0), dependencies);
    await firstStarted;
    const successor = await routes.service.materializeRenderPlaceholder("configured-placeholder-cas", new Date(31_000), dependencies);
    expect(successor.status).toBe("MATERIALIZED");
    releaseFirst();
    await first;
    expect(calls).toBe(2);
    expect(providerPlanCreations).toBe(1);
    expect(await client.digitalHumanRenderPlaceholder.findUnique({ where: { id: "configured-placeholder-cas" } }))
      .toMatchObject({ status: "MATERIALIZED", renderJobId: "configured-job-cas", fallbackReason: null });
  });
});

function renderSnapshot(id: string) {
  return {
    id,
    status: "PENDING",
    deadlineAt: new Date(8_000).toISOString(),
    readyAt: null,
    winnerProvider: null,
    winnerInterviewer: null,
    winnerAssetId: null,
    fallbackReason: null
  };
}

async function seedConfiguredMaterialization(client: PrismaClient, suffix: string, audioReady = false) {
  const storageId = `configured-storage-${suffix}`;
  const audioId = `configured-audio-${suffix}`;
  const profileId = `configured-profile-${suffix}`;
  const jobId = `configured-job-${suffix}`;
  const placeholderId = `configured-placeholder-${suffix}`;
  const settings = {
    mode: "LINGMOU_ONLY" as const,
    maxWaitMs: 8000 as const,
    lingmouPollMs: [3000, 6000] as const,
    emoPollMs: [8000] as const,
    synchronizeProfiles: true,
    primaryProfileId: profileId,
    secondaryProfileId: null,
    lingmouModelId: `lingmou-${suffix}`,
    emoModelId: `emo-${suffix}`
  };
  await client.mediaStorageConfig.create({ data: {
    id: storageId,
    displayName: storageId,
    providerKind: "ALI_OSS",
    endpoint: "oss.example.invalid",
    bucket: "private"
  } });
  await client.digitalHumanMediaAsset.create({ data: {
    id: audioId,
    storageConfigId: storageId,
    objectKey: `media/audio/${suffix}.wav`,
    mimeType: "audio/wav",
    byteLength: 100,
    purpose: "TTS_AUDIO"
  } });
  await client.interviewerAvatarProfile.create({ data: {
    id: profileId,
    displayName: "Interviewer",
    voice: "voice",
    providerRole: "PRIMARY"
  } });
  await client.digitalHumanRenderJob.create({ data: {
    id: jobId,
    trainingSessionId: "session-a",
    questionId: `configured-${suffix}`,
    questionHash: `configured-hash-${suffix}`,
    cacheKey: `configured-cache-${suffix}`,
    kind: "PRESET",
    mode: "LINGMOU_ONLY",
    status: "PENDING",
    interviewerProfileId: profileId,
    audioAssetId: audioId,
    planFingerprint: `configured-plan-${suffix}`,
    createdAt: new Date(0),
    deadlineAt: new Date(8_000)
  } });
  await client.digitalHumanRenderPlaceholder.create({ data: {
    id: placeholderId,
    trainingSessionId: "session-a",
    questionId: `configured-placeholder-question-${suffix}`,
    questionHash: `placeholder-hash-${suffix}`,
    cacheKey: `placeholder-cache-${suffix}`,
    kind: "PRESET",
    stage: "WARM_UP",
    questionText: "Configured?",
    ...(audioReady ? {
      status: "MATERIALIZING",
      audioAssetId: audioId,
      runtimeSettingsJson: JSON.stringify(settings),
      renderCreatedAt: new Date(0),
      deadlineAt: new Date(8_000),
      claimToken: null,
      claimExpiresAt: new Date(0)
    } : {})
  } });
  return settings;
}

async function seedSessions(client: PrismaClient) {
  for (const suffix of ["a", "b"] as const) {
    await client.candidate.create({ data: { id: `candidate-${suffix}`, name: suffix.toUpperCase() } });
    await client.trainingTask.create({
      data: {
        id: `task-${suffix}`,
        candidateId: `candidate-${suffix}`,
        title: "Interview",
        targetCompany: "Acme",
        targetRole: "Engineer",
        stageConfig: "[]",
        expectedMinutes: 10
      }
    });
    const outline = {
      title: "Outline",
      targetRole: "Engineer",
      stages: ["WARM_UP"],
      estimatedMinutes: 1,
      questions: [{
        id: `q-${suffix}`,
        stage: "WARM_UP",
        prompt: `Question ${suffix}`,
        expectedFocus: [],
        followUps: [],
        difficulty: "LOW",
        timeLimitSeconds: 60
      }]
    };
    await client.trainingSession.create({
      data: {
        id: `session-${suffix}`,
        taskId: `task-${suffix}`,
        candidateId: `candidate-${suffix}`,
        outlineJson: JSON.stringify(outline),
        digitalHumanRenderPlaceholders: {
          create: {
            id: `render-${suffix}`,
            questionId: `q-${suffix}`,
            questionHash: `hash-${suffix}`,
            cacheKey: `preset:hash-${suffix}`,
            kind: "PRESET",
            stage: "WARM_UP",
            questionText: `Question ${suffix}`
          }
        }
      }
    });
  }
  expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
}

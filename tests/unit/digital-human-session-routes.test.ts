import { describe, expect, it, vi } from "vitest";
import type { TrainingOutline } from "@/lib/ai";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { DigitalHumanSessionError } from "@/lib/media/digitalHumanSessions";
import { MediaProviderError } from "@/lib/media/errors";

const outline: TrainingOutline = {
  title: "Interview",
  targetRole: "Product Manager",
  stages: ["FORMAL_INTERVIEW"],
  estimatedMinutes: 10,
  questions: [
    {
      id: "FORMAL_INTERVIEW-1",
      stage: "FORMAL_INTERVIEW",
      prompt: "请介绍项目经验。",
      expectedFocus: ["result"],
      followUps: [],
      difficulty: "MEDIUM",
      timeLimitSeconds: 120
    }
  ]
};

const publicSession = {
  id: "digital-1",
  mode: "LINGMOU_CLOUD" as const,
  status: "READY" as const,
  reasonCode: null,
  connection: {
    appId: "rtc-app",
    avatarUserId: "avatar-user",
    channel: "rtc-channel",
    clientUserId: "client-user",
    serverUserId: "server-user",
    timestamp: 1_784_257_200,
    token: "short-lived-token",
    sessionId: "provider-session-1"
  },
  expiresAt: "2026-07-17T03:15:00.000Z"
};

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, { method, body: JSON.stringify(body) });
}

function routeContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function ttsModel(): ResolvedMediaModel {
  return {
    capability: "TEXT_TO_SPEECH",
    providerId: "tts-provider",
    providerName: "Alibaba Bailian",
    providerType: "TONGYI",
    baseUrl: null,
    providerSettings: { workspaceId: "workspace", region: "cn-beijing" },
    modelId: "tts-model",
    modelDisplayName: "CosyVoice",
    modelName: "cosyvoice-v3-flash",
    modelSettings: { voice: "longanhuan" },
    temperature: 0.2,
    maxTokens: 1000,
    timeoutMs: 30_000,
    credentialEnvelopes: { apiKey: null, structured: null }
  };
}

function speechSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "digital-1",
    status: "READY",
    trainingSessionId: "training-1",
    trainingSession: {
      id: "training-1",
      status: "IN_PROGRESS",
      outlineJson: JSON.stringify(outline),
      turns: []
    },
    ...overrides
  };
}

async function loadRoutes() {
  const createRoute = await import("@/app/api/digital-human/sessions/route");
  const heartbeatRoute = await import(
    "@/app/api/digital-human/sessions/[sessionId]/heartbeat/route"
  );
  const deleteRoute = await import(
    "@/app/api/digital-human/sessions/[sessionId]/route"
  );
  const speechRoute = await import(
    "@/app/api/digital-human/sessions/[sessionId]/speech/route"
  );
  return { createRoute, heartbeatRoute, deleteRoute, speechRoute };
}

describe("digital human session routes", () => {
  it("creates a session using only the public RTC whitelist", async () => {
    const { createRoute } = await loadRoutes();
    const createSession = vi.fn().mockResolvedValue(publicSession);
    const handler = createRoute.createDigitalHumanSessionCreateHandler({
      createSession
    });

    const response = await handler(
      jsonRequest("http://localhost/api/digital-human/sessions", {
        trainingSessionId: "training-1"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ session: publicSession });
    expect(createSession).toHaveBeenCalledWith("training-1");
    expect(JSON.stringify(body)).not.toMatch(/accessKey|nonce|gslb|rtcParams/i);
  });

  it("returns no-store validation and redacted lifecycle errors", async () => {
    const { createRoute } = await loadRoutes();
    const createSession = vi.fn().mockRejectedValue(
      new DigitalHumanSessionError(
        "raw AccessKey sentinel",
        "TRAINING_SESSION_NOT_FOUND",
        404
      )
    );
    const handler = createRoute.createDigitalHumanSessionCreateHandler({
      createSession
    });

    const invalid = await handler(
      jsonRequest("http://localhost/api/digital-human/sessions", {})
    );
    const missing = await handler(
      jsonRequest("http://localhost/api/digital-human/sessions", {
        trainingSessionId: "missing"
      })
    );

    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("Cache-Control")).toBe("no-store");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Digital human session request failed",
      reasonCode: "TRAINING_SESSION_NOT_FOUND"
    });
  });

  it("heartbeats an active session without making a provider call", async () => {
    const { heartbeatRoute } = await loadRoutes();
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const handler = heartbeatRoute.createDigitalHumanSessionHeartbeatHandler({
      heartbeat
    });

    const response = await handler(
      new Request("http://localhost/heartbeat", { method: "POST" }),
      routeContext("digital-1")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
    expect(heartbeat).toHaveBeenCalledWith("digital-1");
  });

  it("returns 404 from heartbeat for an unknown digital human session", async () => {
    const { heartbeatRoute } = await loadRoutes();
    const handler = heartbeatRoute.createDigitalHumanSessionHeartbeatHandler({
      heartbeat: vi.fn().mockRejectedValue(
        new DigitalHumanSessionError(
          "not found",
          "DIGITAL_HUMAN_SESSION_NOT_FOUND",
          404
        )
      )
    });

    const response = await handler(
      new Request("http://localhost/heartbeat", { method: "POST" }),
      routeContext("missing")
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps repeated DELETE idempotent", async () => {
    const { deleteRoute } = await loadRoutes();
    const stop = vi.fn().mockResolvedValue(undefined);
    const handler = deleteRoute.createDigitalHumanSessionDeleteHandler({ stop });

    const first = await handler(
      new Request("http://localhost/session", { method: "DELETE" }),
      routeContext("digital-1")
    );
    const second = await handler(
      new Request("http://localhost/session", { method: "DELETE" }),
      routeContext("digital-1")
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(await second.json()).toEqual({ ok: true });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("streams PCM only after active-session and question-ownership checks", async () => {
    const { speechRoute } = await loadRoutes();
    const logCall = vi.fn().mockResolvedValue(undefined);
    const markReady = vi.fn().mockResolvedValue(undefined);
    const streamPcm = vi.fn().mockResolvedValue({
      provider: "Alibaba Bailian",
      model: "cosyvoice-v3-flash",
      mode: "ALIBABA_TTS",
      traceId: "trace-1",
      fallbackUsed: false,
      encoding: "pcm_s16le",
      sampleRate: 48000,
      channels: 1,
      chunks: (async function* () {
        yield Uint8Array.from([1, 0, 2, 0]);
        yield Uint8Array.from([3, 0, 4, 0]);
      })()
    });
    const handler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(speechSession()),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn().mockResolvedValue(true),
      markReady,
      resolveModel: vi.fn().mockResolvedValue(ttsModel()),
      streamPcm,
      logCall,
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValue(1_125)
    });

    const response = await handler(
      jsonRequest("http://localhost/speech", {
        questionId: "FORMAL_INTERVIEW-1",
        text: "请介绍项目经验。",
        speed: 0.95
      }),
      routeContext("digital-1")
    );
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/pcm");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Audio-Format")).toBe("pcm_s16le");
    expect(response.headers.get("X-Audio-Sample-Rate")).toBe("48000");
    expect(response.headers.get("X-Audio-Channels")).toBe("1");
    expect(bytes).toEqual(Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0]));
    expect(streamPcm).toHaveBeenCalledWith(
      expect.objectContaining({ text: "请介绍项目经验。", speed: 0.95 })
    );
    expect(markReady).toHaveBeenCalledWith("digital-1");
    expect(logCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "training-1",
        capability: "TEXT_TO_SPEECH",
        provider: "Alibaba Bailian",
        latencyMs: 125,
        success: true,
        failureReason: null
      })
    );
  });

  it.each([
    ["unknown question", speechSession(), "unknown", "请介绍项目经验。", 400],
    [
      "mismatched question text",
      speechSession(),
      "FORMAL_INTERVIEW-1",
      "read arbitrary paid text",
      400
    ],
    [
      "completed training",
      speechSession({
        trainingSession: {
          id: "training-1",
          status: "COMPLETED",
          outlineJson: JSON.stringify(outline),
          turns: []
        }
      }),
      "FORMAL_INTERVIEW-1",
      "请介绍项目经验。",
      409
    ],
    [
      "busy digital human",
      speechSession({ status: "SPEAKING" }),
      "FORMAL_INTERVIEW-1",
      "请介绍项目经验。",
      409
    ]
  ])("rejects %s before billable TTS", async (_name, session, questionId, text, status) => {
    const { speechRoute } = await loadRoutes();
    const streamPcm = vi.fn();
    const handler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(session),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn(),
      markReady: vi.fn(),
      resolveModel: vi.fn(),
      streamPcm,
      logCall: vi.fn()
    });

    const response = await handler(
      jsonRequest("http://localhost/speech", { questionId, text }),
      routeContext("digital-1")
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(streamPcm).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing session and 429 before provider work", async () => {
    const { speechRoute } = await loadRoutes();
    const streamPcm = vi.fn();
    const missingHandler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(null),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn(),
      markReady: vi.fn(),
      resolveModel: vi.fn(),
      streamPcm,
      logCall: vi.fn()
    });
    const findSession = vi.fn();
    const limitedHandler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession,
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: false }),
      markSpeaking: vi.fn(),
      markReady: vi.fn(),
      resolveModel: vi.fn(),
      streamPcm,
      logCall: vi.fn()
    });
    const request = () =>
      jsonRequest("http://localhost/speech", {
        questionId: "FORMAL_INTERVIEW-1",
        text: "请介绍项目经验。"
      });

    expect((await missingHandler(request(), routeContext("missing"))).status).toBe(404);
    expect((await limitedHandler(request(), routeContext("digital-1"))).status).toBe(429);
    expect(findSession).not.toHaveBeenCalled();
    expect(streamPcm).not.toHaveBeenCalled();
  });

  it("returns a redacted 503 fallback and logs only a safe provider code", async () => {
    const { speechRoute } = await loadRoutes();
    const logCall = vi.fn().mockResolvedValue(undefined);
    const markReady = vi.fn().mockResolvedValue(undefined);
    const handler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(speechSession()),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn().mockResolvedValue(true),
      markReady,
      resolveModel: vi.fn().mockResolvedValue(ttsModel()),
      streamPcm: vi.fn().mockRejectedValue(
        new MediaProviderError(
          "raw AccessKey and RTC token sentinel",
          "TONGYI",
          "ALIBABA_TTS_HTTP_503",
          true
        )
      ),
      logCall,
      now: vi.fn().mockReturnValueOnce(2_000).mockReturnValue(2_080)
    });

    const response = await handler(
      jsonRequest("http://localhost/speech", {
        questionId: "FORMAL_INTERVIEW-1",
        text: "请介绍项目经验。"
      }),
      routeContext("digital-1")
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      mode: "BROWSER_TTS_FALLBACK",
      reasonCode: "TTS_UNAVAILABLE"
    });
    expect(JSON.stringify(body)).not.toMatch(/AccessKey|RTC token|sentinel/i);
    expect(markReady).toHaveBeenCalledWith("digital-1");
    expect(logCall).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        failureReason: "ALIBABA_TTS_HTTP_503"
      })
    );
  });

  it("returns safe no-store JSON when the SPEAKING claim fails", async () => {
    const { speechRoute } = await loadRoutes();
    const markReady = vi.fn();
    const streamPcm = vi.fn();
    const logCall = vi.fn();
    const handler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(speechSession()),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn().mockRejectedValue(
        new Error("database contained AccessKey sentinel")
      ),
      markReady,
      resolveModel: vi.fn(),
      streamPcm,
      logCall
    });

    const response = await handler(
      jsonRequest("http://localhost/speech", {
        questionId: "FORMAL_INTERVIEW-1",
        text: "请介绍项目经验。"
      }),
      routeContext("digital-1")
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("AccessKey");
    expect(markReady).not.toHaveBeenCalled();
    expect(streamPcm).not.toHaveBeenCalled();
    expect(logCall).not.toHaveBeenCalled();
  });

  it("releases a claimed session when stream iterator initialization fails", async () => {
    const { speechRoute } = await loadRoutes();
    const markReady = vi.fn().mockResolvedValue(undefined);
    const logCall = vi.fn().mockResolvedValue(undefined);
    const handler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(speechSession()),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn().mockResolvedValue(true),
      markReady,
      resolveModel: vi.fn().mockResolvedValue(ttsModel()),
      streamPcm: vi.fn().mockResolvedValue({
        provider: "Alibaba Bailian",
        model: "cosyvoice-v3-flash",
        mode: "ALIBABA_TTS",
        traceId: "trace-init-failure",
        fallbackUsed: false,
        encoding: "pcm_s16le",
        sampleRate: 48000,
        channels: 1,
        chunks: {
          [Symbol.asyncIterator]() {
            throw new Error("raw iterator token sentinel");
          }
        }
      }),
      logCall,
      now: vi.fn().mockReturnValueOnce(3_000).mockReturnValue(3_050)
    });

    const response = await handler(
      jsonRequest("http://localhost/speech", {
        questionId: "FORMAL_INTERVIEW-1",
        text: "请介绍项目经验。"
      }),
      routeContext("digital-1")
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      mode: "BROWSER_TTS_FALLBACK",
      reasonCode: "TTS_UNAVAILABLE"
    });
    expect(markReady).toHaveBeenCalledWith("digital-1");
    expect(logCall).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        failureReason: "TTS_UNAVAILABLE"
      })
    );
  });

  it("returns the upstream iterator when the client cancels the PCM response", async () => {
    const { speechRoute } = await loadRoutes();
    const iterator = {
      next: vi.fn().mockReturnValue(new Promise(() => undefined)),
      return: vi.fn().mockResolvedValue({ done: true, value: undefined })
    };
    const handler = speechRoute.createDigitalHumanSpeechStreamHandler({
      findSession: vi.fn().mockResolvedValue(speechSession()),
      consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
      markSpeaking: vi.fn().mockResolvedValue(true),
      markReady: vi.fn().mockResolvedValue(undefined),
      resolveModel: vi.fn().mockResolvedValue(ttsModel()),
      streamPcm: vi.fn().mockResolvedValue({
        provider: "Alibaba Bailian",
        model: "cosyvoice-v3-flash",
        mode: "ALIBABA_TTS",
        traceId: "trace-2",
        fallbackUsed: false,
        encoding: "pcm_s16le",
        sampleRate: 48000,
        channels: 1,
        chunks: { [Symbol.asyncIterator]: () => iterator }
      }),
      logCall: vi.fn().mockResolvedValue(undefined)
    });
    const response = await handler(
      jsonRequest("http://localhost/speech", {
        questionId: "FORMAL_INTERVIEW-1",
        text: "请介绍项目经验。"
      }),
      routeContext("digital-1")
    );

    await response.body?.cancel();

    expect(iterator.return).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createSpeechRecognitionSessionHandler } from "@/lib/media/speechRecognitionSession";
import { MediaConfigurationError } from "@/lib/media/errors";
import type { ResolvedMediaModel } from "@/lib/media/config";

function asrModel(): ResolvedMediaModel {
  return {
    capability: "SPEECH_TO_TEXT",
    providerId: "provider-1",
    providerName: "阿里百炼",
    providerType: "TONGYI",
    providerConfigVersion: 0,
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    providerSettings: {
      workspaceId: "ws-main",
      region: "cn-beijing"
    },
    modelId: "model-asr",
    modelDisplayName: "阿里实时语音识别",
    modelName: "qwen3-asr-flash-realtime",
    modelSettings: {
      language: "zh-CN",
      sampleRate: 16000,
      encoding: "pcm"
    },
    temperature: 0,
    maxTokens: 1000,
    timeoutMs: 30_000,
    credentialEnvelopes: {
      apiKey: null,
      structured: null
    }
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    findSession: vi.fn().mockResolvedValue({
      id: "session-1",
      status: "IN_PROGRESS"
    }),
    resolveModel: vi.fn().mockResolvedValue(asrModel()),
    validateCredentials: vi.fn().mockReturnValue({
      apiKey: "asr-api-key-sentinel",
      workspaceId: "ws-main",
      region: "cn-beijing"
    }),
    issueTicket: vi.fn().mockReturnValue("one-time-ticket"),
    consumeRateLimit: vi.fn().mockReturnValue({
      allowed: true,
      remaining: 9,
      resetAt: 61_000
    }),
    now: vi.fn().mockReturnValue(1_000),
    ...overrides
  };
}

describe("speech recognition session API", () => {
  it("issues a short-lived same-origin ticket for an active training session", async () => {
    const deps = dependencies();
    const handler = createSpeechRecognitionSessionHandler(deps);
    const response = await handler(
      new Request("http://localhost/api/speech-recognition/sessions", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1" })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.resolveModel).toHaveBeenCalledWith("SPEECH_TO_TEXT");
    expect(deps.validateCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "model-asr" })
    );
    expect(deps.issueTicket).toHaveBeenCalledWith(
      { sessionId: "session-1", modelId: "model-asr" },
      60_000
    );
    expect(payload).toEqual({
      mode: "ALIBABA_REALTIME_ASR",
      webSocketUrl: "/ws/asr?ticket=one-time-ticket",
      expiresAt: "1970-01-01T00:01:01.000Z",
      model: "qwen3-asr-flash-realtime",
      audio: {
        format: "pcm",
        sampleRate: 16000,
        channels: 1,
        language: "zh"
      }
    });
    expect(JSON.stringify(payload)).not.toContain("asr-api-key-sentinel");
  });

  it("rejects sessions that are not accepting answers", async () => {
    const deps = dependencies({
      findSession: vi.fn().mockResolvedValue({
        id: "session-1",
        status: "COMPLETED"
      })
    });
    const handler = createSpeechRecognitionSessionHandler(deps);
    const response = await handler(
      new Request("http://localhost/api/speech-recognition/sessions", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1" })
      })
    );

    expect(response.status).toBe(409);
    expect(deps.issueTicket).not.toHaveBeenCalled();
  });

  it("limits ticket creation per training session", async () => {
    const deps = dependencies({
      consumeRateLimit: vi.fn().mockReturnValue({
        allowed: false,
        remaining: 0,
        resetAt: 61_000
      })
    });
    const handler = createSpeechRecognitionSessionHandler(deps);
    const response = await handler(
      new Request("http://localhost/api/speech-recognition/sessions", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1" })
      })
    );

    expect(response.status).toBe(429);
    expect(deps.resolveModel).not.toHaveBeenCalled();
  });

  it("returns a safe configuration error without leaking credentials", async () => {
    const deps = dependencies({
      validateCredentials: vi.fn(() => {
        throw new MediaConfigurationError(
          "missing asr-api-key-sentinel",
          { code: "ALIBABA_ASR_API_KEY_REQUIRED" }
        );
      })
    });
    const handler = createSpeechRecognitionSessionHandler(deps);
    const response = await handler(
      new Request("http://localhost/api/speech-recognition/sessions", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1" })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "Speech recognition unavailable",
      code: "ALIBABA_ASR_API_KEY_REQUIRED",
      message: "请先在后台完成当前语音识别模型配置。"
    });
    expect(JSON.stringify(payload)).not.toContain("asr-api-key-sentinel");
  });

  it("refuses a candidate cookie bound to a different training session", async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ type: "candidate", trainingSessionId: "session-2", candidateId: "candidate-1" })
    });
    const handler = createSpeechRecognitionSessionHandler(deps);

    const response = await handler(
      new Request("https://coach.example/api/speech-recognition/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" })
      })
    );

    expect(response.status).toBe(403);
    expect(deps.findSession).not.toHaveBeenCalled();
    expect(deps.issueTicket).not.toHaveBeenCalled();
  });
});

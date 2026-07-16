import { describe, expect, it, vi } from "vitest";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaProviderError } from "@/lib/media/errors";

function resolvedTtsModel(): ResolvedMediaModel {
  return {
    capability: "TEXT_TO_SPEECH",
    providerId: "provider-tts",
    providerName: "阿里百炼",
    providerType: "TONGYI",
    baseUrl: null,
    providerSettings: { workspaceId: "ws-main", region: "cn-beijing" },
    modelId: "model-tts",
    modelDisplayName: "阿里面试官语音",
    modelName: "qwen3-tts-instruct-flash",
    modelSettings: { voice: "Cherry" },
    temperature: 0.2,
    maxTokens: 1000,
    timeoutMs: 30_000,
    credentialEnvelopes: { apiKey: null, structured: null }
  };
}

describe("digital human provider-ready API routes", () => {
  it("returns Alibaba audio and records a real successful TTS call", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const logCall = vi.fn().mockResolvedValue(undefined);
    const handler = route.createDigitalHumanSpeechHandler({
      findSession: vi.fn().mockResolvedValue({
        id: "session-1",
        status: "IN_PROGRESS"
      }),
      consumeRateLimit: vi.fn().mockReturnValue({
        allowed: true,
        remaining: 29,
        resetAt: 61_000
      }),
      resolveModel: vi.fn().mockResolvedValue(resolvedTtsModel()),
      synthesize: vi.fn().mockResolvedValue({
        provider: "阿里百炼",
        model: "qwen3-tts-instruct-flash",
        mode: "ALIBABA_TTS",
        traceId: "request-tts-1",
        fallbackUsed: false,
        audioUrl: "https://example.aliyuncs.com/interviewer.wav",
        mimeType: "audio/wav",
        expiresAt: "2026-07-17T00:00:00.000Z"
      }),
      logCall,
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValue(1_125)
    });
    const response = await handler(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({
          text: "请先做一个一分钟自我介绍。",
          voice: "professional-female",
          language: "zh-CN",
          instructions: "语气专业、亲切。",
          sessionId: "session-1",
          questionId: "question-1"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("ALIBABA_TTS");
    expect(payload.fallbackUsed).toBe(false);
    expect(payload.providerCapability).toBe("TEXT_TO_SPEECH");
    expect(payload.speech.audioUrl).toContain("interviewer.wav");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(logCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        capability: "TEXT_TO_SPEECH",
        provider: "阿里百炼",
        latencyMs: 125,
        success: true,
        failureReason: null,
        fallbackProvider: null
      })
    );
  });

  it("logs provider failure before returning a redacted browser fallback", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const logCall = vi.fn().mockResolvedValue(undefined);
    const handler = route.createDigitalHumanSpeechHandler({
      findSession: vi.fn().mockResolvedValue({
        id: "session-1",
        status: "IN_PROGRESS"
      }),
      consumeRateLimit: vi.fn().mockReturnValue({
        allowed: true,
        remaining: 29,
        resetAt: 62_000
      }),
      resolveModel: vi.fn().mockResolvedValue(resolvedTtsModel()),
      synthesize: vi.fn().mockRejectedValue(
        new MediaProviderError(
          "upstream included tts-api-key-sentinel",
          "TONGYI",
          "ALIBABA_TTS_HTTP_503",
          true
        )
      ),
      logCall,
      now: vi.fn().mockReturnValueOnce(2_000).mockReturnValue(2_080)
    });
    const response = await handler(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({
          text: "请介绍项目经验。",
          sessionId: "session-1"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      mode: "BROWSER_TTS_FALLBACK",
      providerCapability: "TEXT_TO_SPEECH",
      fallbackUsed: true,
      reasonCode: "ALIBABA_TTS_HTTP_503"
    });
    expect(JSON.stringify(payload)).not.toContain("tts-api-key-sentinel");
    expect(payload.speech.voice).toBe("browser-default");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(logCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        capability: "TEXT_TO_SPEECH",
        provider: "阿里百炼",
        latencyMs: 80,
        success: false,
        failureReason: "ALIBABA_TTS_HTTP_503",
        fallbackProvider: "browser-speechSynthesis"
      })
    );
  });

  it("rejects missing or inactive sessions before any billable TTS call", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const synthesize = vi.fn();
    const logCall = vi.fn();
    const handler = route.createDigitalHumanSpeechHandler({
      findSession: vi.fn().mockResolvedValue(null),
      consumeRateLimit: vi.fn().mockReturnValue({
        allowed: true,
        remaining: 29,
        resetAt: 63_000
      }),
      resolveModel: vi.fn(),
      synthesize,
      logCall
    });
    const response = await handler(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({ text: "请自我介绍。", sessionId: "missing" })
      })
    );

    expect(response.status).toBe(404);
    expect(synthesize).not.toHaveBeenCalled();
    expect(logCall).not.toHaveBeenCalled();
  });

  it("rate limits TTS generation per active session", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const findSession = vi.fn();
    const synthesize = vi.fn();
    const handler = route.createDigitalHumanSpeechHandler({
      findSession,
      consumeRateLimit: vi.fn().mockReturnValue({
        allowed: false,
        remaining: 0,
        resetAt: 64_000
      }),
      resolveModel: vi.fn(),
      synthesize,
      logCall: vi.fn()
    });
    const response = await handler(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({ text: "请自我介绍。", sessionId: "session-1" })
      })
    );

    expect(response.status).toBe(429);
    expect(findSession).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("rejects Qwen TTS text beyond the documented 600-character limit", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const resolveModel = vi.fn();
    const response = await route.createDigitalHumanSpeechHandler({
      findSession: vi.fn(),
      consumeRateLimit: vi.fn(),
      resolveModel,
      synthesize: vi.fn(),
      logCall: vi.fn()
    })(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({
          text: "你".repeat(601),
          sessionId: "session-1"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it("does not return provider success when the required call log cannot be stored", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const handler = route.createDigitalHumanSpeechHandler({
      findSession: vi.fn().mockResolvedValue({
        id: "session-1",
        status: "IN_PROGRESS"
      }),
      consumeRateLimit: vi.fn().mockReturnValue({
        allowed: true,
        remaining: 29,
        resetAt: 65_000
      }),
      resolveModel: vi.fn().mockResolvedValue(resolvedTtsModel()),
      synthesize: vi.fn().mockResolvedValue({
        provider: "阿里百炼",
        model: "qwen3-tts-instruct-flash",
        mode: "ALIBABA_TTS",
        traceId: "request-tts-2",
        fallbackUsed: false,
        audioUrl: "https://example.aliyuncs.com/interviewer.wav",
        mimeType: "audio/wav"
      }),
      logCall: vi.fn().mockRejectedValue(new Error("database unavailable"))
    });
    const response = await handler(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({ text: "请自我介绍。", sessionId: "session-1" })
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("returns a client-render fallback contract from the digital human render interface", async () => {
    const route = await import("@/app/api/digital-human/render/route");
    const response = await route.POST(
      new Request("http://localhost/api/digital-human/render", {
        method: "POST",
        body: JSON.stringify({
          text: "你刚才提到增长指标，请补充具体数字。",
          avatarId: "interviewer-default",
          expression: "probing"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("CLIENT_RENDER_FALLBACK");
    expect(payload.providerCapability).toBe("DIGITAL_HUMAN_VIDEO");
    expect(payload.render.expression).toBe("probing");
  });

  it("summarizes observable behavior signals through the behavior-analysis interface", async () => {
    const route = await import("@/app/api/behavior-analysis/route");
    const response = await route.POST(
      new Request("http://localhost/api/behavior-analysis", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          questionId: "FORMAL_INTERVIEW-1",
          signals: {
            answerDurationSeconds: 95,
            transcriptLength: 80,
            averageVolume: 42,
            peakVolume: 78,
            longPauseCount: 2,
            cameraEnabled: true,
            microphoneEnabled: true,
            speechRecognitionUsed: true
          }
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("LOCAL_SIGNAL_SUMMARY");
    expect(payload.providerCapability).toBe("VISION_BEHAVIOR_ANALYSIS");
    expect(payload.summary.observations.join(" ")).toContain("长停顿");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  buildAlibabaTtsUrl,
  createAlibabaTtsProvider
} from "@/lib/media/providers/alibabaTts";
import { resolveAlibabaTtsCredentials } from "@/lib/media/providers/alibabaCredentials";
import {
  encryptCredentialMap,
  encryptSecret
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";

const configSecret = "alibaba-tts-test-config-secret";

function resolvedTtsModel(): ResolvedMediaModel {
  return {
    capability: "TEXT_TO_SPEECH",
    providerId: "provider-tts",
    providerName: "阿里百炼",
    providerType: "TONGYI",
    baseUrl: null,
    providerSettings: {
      workspaceId: "ws-main",
      region: "cn-beijing"
    },
    modelId: "model-tts",
    modelDisplayName: "阿里面试官语音",
    modelName: "qwen3-tts-instruct-flash-2026-01-26",
    modelSettings: {
      voice: "Cherry",
      instructions: "语气专业、自然。"
    },
    temperature: 0.2,
    maxTokens: 1000,
    timeoutMs: 30_000,
    credentialEnvelopes: {
      apiKey: encryptSecret("main-api-key-sentinel", configSecret),
      structured: encryptCredentialMap(
        { ttsApiKey: "tts-api-key-sentinel" },
        configSecret
      )
    }
  };
}

function successfulResponse(status = 200) {
  return new Response(
    JSON.stringify({
      status_code: 200,
      request_id: "request-tts-1",
      output: {
        finish_reason: "stop",
        audio: {
          data: "",
          url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?Expires=1780000000",
          id: "audio-request-tts-1",
          expires_at: 1_780_000_000
        }
      }
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

describe("Alibaba Qwen HTTP TTS provider", () => {
  it("builds the workspace-scoped multimodal generation endpoint", () => {
    expect(
      buildAlibabaTtsUrl({ workspaceId: "ws-1", region: "cn-beijing" })
    ).toBe(
      "https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    );
  });

  it("prefers the TTS-specific key without exposing credentials", () => {
    expect(
      resolveAlibabaTtsCredentials(resolvedTtsModel(), () => configSecret)
    ).toEqual({
      apiKey: "tts-api-key-sentinel",
      workspaceId: "ws-main",
      region: "cn-beijing"
    });
  });

  it("uses the selected database model and returns a playable signed URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const result = await provider.synthesize({
      text: "Please introduce yourself.",
      voice: "Ethan",
      language: "en-US",
      instructions: "Speak calmly and professionally."
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://ws-main.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    );
    expect(init.headers).toEqual({
      Authorization: "Bearer tts-api-key-sentinel",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "qwen3-tts-instruct-flash-2026-01-26",
      input: {
        text: "Please introduce yourself.",
        voice: "Ethan",
        language_type: "English",
        instructions: "Speak calmly and professionally."
      }
    });
    expect(result).toEqual({
      provider: "阿里百炼",
      model: "qwen3-tts-instruct-flash-2026-01-26",
      mode: "ALIBABA_TTS",
      traceId: "request-tts-1",
      fallbackUsed: false,
      audioUrl:
        "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?Expires=1780000000",
      mimeType: "audio/wav",
      expiresAt: "2026-05-28T20:26:40.000Z"
    });
  });

  it("retries exactly once for retryable upstream statuses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(successfulResponse());
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(provider.synthesize({ text: "你好" })).resolves.toMatchObject({
      mode: "ALIBABA_TTS"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors or expose upstream secrets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("tts-api-key-sentinel was rejected", { status: 400 })
    );
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const error = await provider.synthesize({ text: "你好" }).catch((caught) => caught);

    expect(error).toMatchObject({
      name: "MediaProviderError",
      code: "ALIBABA_TTS_HTTP_400",
      retryable: false
    });
    expect(JSON.stringify(error)).not.toContain("tts-api-key-sentinel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects WebSocket-only realtime models before making an HTTP request", async () => {
    const model = resolvedTtsModel();
    model.modelName = "qwen3-tts-instruct-flash-realtime";
    const fetchMock = vi.fn();
    const provider = createAlibabaTtsProvider(model, {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(provider.synthesize({ text: "你好" })).rejects.toMatchObject({
      code: "ALIBABA_TTS_HTTP_MODEL_REQUIRED"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unrelated model names before making an HTTP request", async () => {
    const model = resolvedTtsModel();
    model.modelName = "Qwen-Audio-TTS";
    const fetchMock = vi.fn();
    const provider = createAlibabaTtsProvider(model, {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(provider.synthesize({ text: "你好" })).rejects.toMatchObject({
      code: "ALIBABA_TTS_MODEL_INVALID"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized text and instructions before making a provider request", async () => {
    const fetchMock = vi.fn();
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(
      provider.synthesize({ text: "a".repeat(601) })
    ).rejects.toMatchObject({ code: "ALIBABA_TTS_INPUT_INVALID" });
    await expect(
      provider.synthesize({
        text: "hello",
        instructions: "a".repeat(1601)
      })
    ).rejects.toMatchObject({ code: "ALIBABA_TTS_INPUT_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

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
const encoder = new TextEncoder();

function resolvedTtsModel(): ResolvedMediaModel {
  return {
    capability: "TEXT_TO_SPEECH",
    providerId: "provider-tts",
    providerName: "Alibaba Bailian",
    providerType: "TONGYI",
    baseUrl: null,
    providerSettings: { workspaceId: "ws-main", region: "cn-beijing" },
    modelId: "model-tts",
    modelDisplayName: "Interview voice",
    modelName: "cosyvoice-v3-flash",
    modelSettings: {
      voice: "longanhuan",
      format: "pcm",
      sampleRate: 48000,
      channels: 1,
      instruction: "你说话的情感是 neutral."
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

function sseEvent(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function successfulSse() {
  return [
    sseEvent({ request_id: "request-tts-1", output: { type: "sentence-begin" } }),
    sseEvent({
      request_id: "request-tts-1",
      output: { type: "sentence-synthesis", audio: { data: "AQACAA==" } }
    }),
    sseEvent({
      request_id: "request-tts-1",
      output: { type: "sentence-synthesis", audio: { data: "AwAEAA==" } }
    }),
    sseEvent({ request_id: "request-tts-1", output: { type: "sentence-end" } }),
    sseEvent({ request_id: "request-tts-1", output: { finish_reason: "stop" } })
  ];
}

function sseResponse(events: string[], splitAt?: number[]) {
  const source = events.join("");
  const chunks = splitAt
    ? splitAt.map((start, index) =>
        encoder.encode(source.slice(start, splitAt[index + 1]))
      )
    : [encoder.encode(source)];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

async function collect(chunks: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    size += chunk.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

describe("Alibaba CosyVoice HTTP TTS provider", () => {
  it("uses the workspace-scoped CosyVoice streaming endpoint", async () => {
    const events = successfulSse();
    const splitAt = [0, 17, 54, 129, 213, events.join("").length];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events, splitAt));
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const result = await provider.streamPcm({ text: "请做自我介绍。" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ws-main.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-DashScope-SSE": "enable" })
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      model: "cosyvoice-v3-flash",
      input: {
        text: "请做自我介绍。",
        voice: "longanhuan",
        format: "pcm",
        sample_rate: 48000,
        rate: 1,
        instruction: "你说话的情感是 neutral."
      }
    });
    await expect(collect(result.chunks)).resolves.toEqual(
      Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0])
    );
  });

  it("adapts the PCM stream to the legacy synthesis result", async () => {
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: vi.fn().mockResolvedValue(sseResponse(successfulSse())) as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(provider.synthesize({ text: "Hello" })).resolves.toMatchObject({
      provider: "Alibaba Bailian",
      model: "cosyvoice-v3-flash",
      mode: "ALIBABA_TTS",
      traceId: "request-tts-1",
      fallbackUsed: false,
      audioBase64: "AQACAAMABAA=",
      mimeType: "audio/pcm",
      sampleRate: 48000
    });
  });

  it("uses the required neutral instruction when none is configured", async () => {
    const model = resolvedTtsModel();
    model.modelSettings = { voice: "longanhuan", format: "pcm", sampleRate: 48000, channels: 1 };
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(successfulSse()));
    const provider = createAlibabaTtsProvider(model, {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await provider.synthesize({ text: "Hello" });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).input.instruction).toBe(
      "你说话的情感是 neutral."
    );
  });

  it("builds the workspace-scoped CosyVoice endpoint", () => {
    expect(buildAlibabaTtsUrl({ workspaceId: "ws-1", region: "cn-beijing" })).toBe(
      "https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
    );
  });

  it("prefers the TTS-specific key without exposing credentials", () => {
    expect(resolveAlibabaTtsCredentials(resolvedTtsModel(), () => configSecret)).toEqual({
      apiKey: "tts-api-key-sentinel",
      workspaceId: "ws-main",
      region: "cn-beijing"
    });
  });

  it.each([429, 503])("retries exactly once for pre-stream HTTP %i", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status }))
      .mockResolvedValueOnce(sseResponse(successfulSse()));
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(provider.synthesize({ text: "Hello" })).resolves.toMatchObject({
      mimeType: "audio/pcm"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors or expose upstream credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("tts-api-key-sentinel was rejected", { status: 401 })
    );
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const error = await provider.streamPcm({ text: "Hello" }).catch((caught) => caught);

    expect(error).toMatchObject({
      name: "MediaProviderError",
      code: "ALIBABA_TTS_HTTP_401",
      retryable: false
    });
    expect(JSON.stringify(error)).not.toContain("tts-api-key-sentinel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry after PCM has begun when the SSE stream is interrupted", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseEvent({
              request_id: "request-tts-1",
              output: { type: "sentence-synthesis", audio: { data: "AQACAA==" } }
            })
          )
        );
        controller.error(new Error("connection lost"));
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const result = await provider.streamPcm({ text: "Hello" });
    await expect(collect(result.chunks)).rejects.toMatchObject({
      code: "ALIBABA_TTS_STREAM_INTERRUPTED"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid Base64", "not-base64", "ALIBABA_TTS_PCM_BASE64_INVALID"],
    ["odd PCM bytes", "AQ==", "ALIBABA_TTS_PCM_INVALID"]
  ])("rejects %s from a sentence-synthesis event", async (_name, data, code) => {
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            sseEvent({
              request_id: "request-tts-1",
              output: { type: "sentence-synthesis", audio: { data } }
            })
          ])
        ) as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const result = await provider.streamPcm({ text: "Hello" });
    await expect(collect(result.chunks)).rejects.toMatchObject({ code });
  });

  it("rejects a single PCM event above 1 MiB", async () => {
    const data = Buffer.alloc(1024 * 1024 + 2).toString("base64");
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            sseEvent({
              request_id: "request-tts-1",
              output: { type: "sentence-synthesis", audio: { data } }
            })
          ])
        ) as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const result = await provider.streamPcm({ text: "Hello" });
    await expect(collect(result.chunks)).rejects.toMatchObject({
      code: "ALIBABA_TTS_PCM_CHUNK_TOO_LARGE"
    });
  });

  it("rejects PCM streams above 10 MiB in total", async () => {
    const data = Buffer.alloc(1024 * 1024).toString("base64");
    const events = Array.from({ length: 11 }, () =>
      sseEvent({
        request_id: "request-tts-1",
        output: { type: "sentence-synthesis", audio: { data } }
      })
    );
    const provider = createAlibabaTtsProvider(resolvedTtsModel(), {
      fetch: vi.fn().mockResolvedValue(sseResponse(events)) as typeof fetch,
      readConfigSecret: () => configSecret
    });

    const result = await provider.streamPcm({ text: "Hello" });
    await expect(collect(result.chunks)).rejects.toMatchObject({
      code: "ALIBABA_TTS_PCM_TOTAL_TOO_LARGE"
    });
  });

  it("rejects unsupported model names before making an HTTP request", async () => {
    const model = resolvedTtsModel();
    model.modelName = "qwen3-tts-instruct-flash";
    const fetchMock = vi.fn();
    const provider = createAlibabaTtsProvider(model, {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });

    await expect(provider.streamPcm({ text: "Hello" })).rejects.toMatchObject({
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

    await expect(provider.streamPcm({ text: "a".repeat(601) })).rejects.toMatchObject({
      code: "ALIBABA_TTS_INPUT_INVALID"
    });
    await expect(
      provider.streamPcm({ text: "hello", instructions: "a".repeat(1601) })
    ).rejects.toMatchObject({ code: "ALIBABA_TTS_INPUT_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("times out while waiting for the upstream streaming response", async () => {
    vi.useFakeTimers();
    const model = resolvedTtsModel();
    model.timeoutMs = 1;
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    const provider = createAlibabaTtsProvider(model, {
      fetch: fetchMock as typeof fetch,
      readConfigSecret: () => configSecret
    });
    const pending = expect(provider.streamPcm({ text: "Hello" })).rejects.toMatchObject({
      code: "ALIBABA_TTS_TIMEOUT"
    });
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    vi.useRealTimers();
  });
});

import { describe, expect, it } from "vitest";
import {
  encryptCredentialMap,
  encryptSecret
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  createAlibabaEmoProvider,
  resolveAlibabaEmoConfiguration
} from "@/lib/media/video/providers/alibabaEmo";
import type { VideoSubmitInput } from "@/lib/media/video/types";

const configSecret = "alibaba-emo-config-secret";
const apiKey = "dashscope-key-sentinel";
const signedPortraitUrl = "https://signed.example/portrait.png?secret=portrait";
const signedAudioUrl = "https://signed.example/audio.wav?secret=audio";

describe("Alibaba EMO configuration", () => {
  it("resolves the generic encrypted DashScope key and strict EMO settings", () => {
    expect(resolveAlibabaEmoConfiguration(model(), () => configSecret)).toEqual({
      apiKey,
      model: "emo-v1",
      ratio: "1:1",
      styleLevel: "normal"
    });
  });

  it("retains the legacy structured TTS key fallback", () => {
    expect(resolveAlibabaEmoConfiguration(model({
      genericApiKey: null,
      structuredCredentials: { ttsApiKey: "legacy-tts-key" }
    }), () => configSecret)).toEqual({
      apiKey: "legacy-tts-key",
      model: "emo-v1",
      ratio: "1:1",
      styleLevel: "normal"
    });
  });

  it.each([
    ["provider", { providerType: "LINGMOU" }, "ALIBABA_EMO_PROVIDER_REQUIRED"],
    ["capability", { capability: "TEXT_TO_SPEECH" }, "ALIBABA_EMO_PROVIDER_REQUIRED"],
    ["adapter", { modelName: "wan-video" }, "ALIBABA_EMO_ADAPTER_CONFIG_INVALID"],
    ["configured model", { modelSettings: { model: "emo-v2" } }, "ALIBABA_EMO_MODEL_INVALID"],
    ["ratio", { modelSettings: { ratio: "16:9" } }, "ALIBABA_EMO_RATIO_INVALID"],
    ["style level", { modelSettings: { styleLevel: "extreme" } }, "ALIBABA_EMO_STYLE_LEVEL_INVALID"]
  ] as const)("rejects an invalid %s before constructing a provider", (
    _field,
    overrides,
    code
  ) => {
    let fetchCalls = 0;

    expect(() => createAlibabaEmoProvider(model(overrides), {
      fetcher: async () => {
        fetchCalls += 1;
        return response({});
      },
      readConfigSecret: () => configSecret
    })).toThrowError(expect.objectContaining({ code }));
    expect(fetchCalls).toBe(0);
  });

  it("detects the portrait then submits with server-side Bearer authentication", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async (input, init) => {
        calls.push({ input: String(input), init });
        if (calls.length === 1) {
          return response({
            output: {
              check_pass: true,
              face_bbox: [302, 286, 610, 593],
              ext_bbox: [71, 9, 840, 778]
            },
            request_id: "trace-detect"
          });
        }
        return response({
          output: { task_id: "task-01", task_status: "PENDING" },
          request_id: "trace-submit"
        });
      },
      readConfigSecret: () => configSecret
    });

    await expect(provider.submit(validSubmitInput())).resolves.toEqual({
      upstreamTaskId: "task-01",
      traceId: "trace-submit"
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].input).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/face-detect"
    );
    expect(calls[0].init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "emo-detect-v1",
      input: { image_url: signedPortraitUrl },
      parameters: { ratio: "1:1" }
    });
    expect(calls[1].input).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
    );
    expect(calls[1].init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable"
      }
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      model: "emo-v1",
      input: {
        image_url: signedPortraitUrl,
        audio_url: signedAudioUrl,
        face_bbox: [302, 286, 610, 593],
        ext_bbox: [71, 9, 840, 778]
      },
      parameters: { style_level: "normal" }
    });
  });

  it("does not synthesize when official portrait detection rejects the image", async () => {
    const calls: string[] = [];
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async (input) => {
        calls.push(String(input));
        return response({
          output: { check_pass: false, message: "face not found" },
          request_id: "trace-detect-rejected"
        });
      },
      readConfigSecret: () => configSecret
    });

    const caught = await provider.submit(validSubmitInput()).catch((error: unknown) => error);

    expect(caught).toMatchObject({
      name: "MediaProviderError",
      code: "ALIBABA_EMO_PORTRAIT_REJECTED",
      traceId: "trace-detect-rejected"
    });
    expect(calls).toEqual([
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/face-detect"
    ]);
  });

  it.each([
    [
      "audio URL",
      { audioUrl: "http://private.example/audio.wav" },
      "ALIBABA_EMO_AUDIO_URL_INVALID"
    ],
    [
      "portrait URL",
      { portraitUrl: "http://private.example/portrait.png" },
      "ALIBABA_EMO_PORTRAIT_URL_INVALID"
    ],
    [
      "missing portrait",
      { portraitUrl: null },
      "ALIBABA_EMO_PORTRAIT_URL_REQUIRED"
    ],
    [
      "missing audio metadata",
      { audioMetadata: undefined },
      "ALIBABA_EMO_AUDIO_METADATA_REQUIRED"
    ],
    [
      "missing portrait metadata",
      { portraitMetadata: null },
      "ALIBABA_EMO_PORTRAIT_METADATA_REQUIRED"
    ],
    [
      "audio format",
      { audioMetadata: { contentType: "audio/ogg", byteLength: 100 } },
      "ALIBABA_EMO_AUDIO_FORMAT_UNSUPPORTED"
    ],
    [
      "portrait format",
      { portraitMetadata: portraitMetadata({ contentType: "image/gif" }) },
      "ALIBABA_EMO_PORTRAIT_FORMAT_UNSUPPORTED"
    ],
    [
      "audio size",
      { audioMetadata: { contentType: "audio/wav", byteLength: 15 * 1024 * 1024 + 1 } },
      "ALIBABA_EMO_AUDIO_TOO_LARGE"
    ],
    [
      "audio duration",
      { audioMetadata: { contentType: "audio/wav", byteLength: 100, durationSeconds: 60.001 } },
      "ALIBABA_EMO_AUDIO_TOO_LONG"
    ],
    [
      "portrait dimensions",
      { portraitMetadata: { contentType: "image/png", byteLength: 100 } },
      "ALIBABA_EMO_PORTRAIT_DIMENSIONS_REQUIRED"
    ],
    [
      "short portrait side",
      { portraitMetadata: portraitMetadata({ width: 399 }) },
      "ALIBABA_EMO_PORTRAIT_TOO_SMALL"
    ],
    [
      "long portrait side",
      { portraitMetadata: portraitMetadata({ height: 7001 }) },
      "ALIBABA_EMO_PORTRAIT_TOO_LARGE"
    ]
  ] as const)("rejects invalid %s metadata before fetch", async (
    _field,
    overrides,
    code
  ) => {
    let fetchCalls = 0;
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async () => {
        fetchCalls += 1;
        return response({});
      },
      readConfigSecret: () => configSecret
    });

    await expect(provider.submit({
      ...validSubmitInput(),
      ...overrides
    } as VideoSubmitInput)).rejects.toMatchObject({
      name: "MediaConfigurationError",
      code
    });
    expect(fetchCalls).toBe(0);
  });

  it.each([
    ["image/jpeg", "audio/mpeg"],
    ["image/png", "audio/wav"],
    ["image/bmp", "audio/x-wav"],
    ["image/webp", "audio/mp3"]
  ])("accepts supported portrait %s and audio %s metadata", async (
    portraitContentType,
    audioContentType
  ) => {
    let fetchCalls = 0;
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async () => {
        fetchCalls += 1;
        return fetchCalls === 1
          ? detectionPassedResponse()
          : response({
            output: { task_id: "task-01", task_status: "PENDING" },
            request_id: "trace-submit"
          });
      },
      readConfigSecret: () => configSecret
    });

    await provider.submit({
      ...validSubmitInput(),
      audioMetadata: {
        contentType: audioContentType,
        byteLength: 15 * 1024 * 1024,
        durationSeconds: 60
      },
      portraitMetadata: portraitMetadata({ contentType: portraitContentType })
    });
    expect(fetchCalls).toBe(2);
  });

  it("turns an invalid submit Response into a sanitized provider error with trace", async () => {
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async (input) => String(input).endsWith("/face-detect")
        ? detectionPassedResponse()
        : response({
          request_id: "trace-rejected",
          code: "InvalidParameter",
          message: `sensitive ${apiKey} ${signedPortraitUrl}`
        }, 400),
      readConfigSecret: () => configSecret
    });

    const caught = await provider.submit(validSubmitInput()).catch((error: unknown) => error);

    expect(caught).toMatchObject({
      name: "MediaProviderError",
      provider: "TONGYI",
      code: "ALIBABA_EMO_REQUEST_REJECTED",
      traceId: "trace-rejected"
    });
    expect(String(caught)).not.toContain(apiKey);
    expect(JSON.stringify(caught)).not.toContain(signedPortraitUrl);
  });

  it("sanitizes fetch failures without leaking authorization or signed URLs", async () => {
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async () => {
        throw new Error(`network ${apiKey} ${signedAudioUrl}`);
      },
      readConfigSecret: () => configSecret
    });

    const caught = await provider.submit(validSubmitInput()).catch((error: unknown) => error);

    expect(caught).toMatchObject({
      name: "MediaProviderError",
      provider: "TONGYI",
      code: "ALIBABA_EMO_UPSTREAM_FAILED",
      traceId: null
    });
    expect(String(caught)).not.toContain(apiKey);
    expect(JSON.stringify(caught)).not.toContain(signedAudioUrl);
  });

  it("queries through the official endpoint and returns the shared result", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async (input, init) => {
        calls.push({ input: String(input), init });
        return response({
          request_id: "trace-query",
          output: { task_id: "task-01", task_status: "RUNNING" }
        });
      },
      readConfigSecret: () => configSecret
    });

    await expect(provider.query("task-01")).resolves.toEqual({
      status: "RUNNING",
      videoUrl: null,
      safeErrorCode: null,
      traceId: "trace-query",
      completedAt: null
    });
    expect(calls).toEqual([{
      input: "https://dashscope.aliyuncs.com/api/v1/tasks/task-01",
      init: {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    }]);
  });

  it("maps query fetch failures into a safe shared failed result", async () => {
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async () => {
        throw new Error(`network ${apiKey} ${signedAudioUrl}`);
      },
      readConfigSecret: () => configSecret
    });

    await expect(provider.query("task-01")).resolves.toEqual({
      status: "FAILED",
      videoUrl: null,
      safeErrorCode: "ALIBABA_EMO_UPSTREAM_FAILED",
      traceId: null,
      completedAt: null
    });
  });

  it("rejects an empty task id before fetch", async () => {
    let fetchCalls = 0;
    const provider = createAlibabaEmoProvider(model(), {
      fetcher: async () => {
        fetchCalls += 1;
        return response({});
      },
      readConfigSecret: () => configSecret
    });

    await expect(provider.query("  ")).rejects.toMatchObject({
      name: "MediaConfigurationError",
      code: "ALIBABA_EMO_TASK_ID_REQUIRED"
    });
    expect(fetchCalls).toBe(0);
  });
});

function validSubmitInput(): VideoSubmitInput {
  return {
    requestName: "render-01",
    audioUrl: signedAudioUrl,
    portraitUrl: signedPortraitUrl,
    audioMetadata: {
      contentType: "audio/wav",
      byteLength: 1024,
      durationSeconds: 30
    },
    portraitMetadata: portraitMetadata()
  };
}

function portraitMetadata(overrides: Record<string, unknown> = {}) {
  return {
    contentType: "image/png",
    byteLength: 2048,
    width: 512,
    height: 512,
    ...overrides
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function detectionPassedResponse() {
  return response({
    output: {
      check_pass: true,
      face_bbox: [302, 286, 610, 593],
      ext_bbox: [71, 9, 840, 778]
    },
    request_id: "trace-detect"
  });
}

function model(overrides: {
  providerType?: string;
  capability?: "DIGITAL_HUMAN_VIDEO" | "TEXT_TO_SPEECH";
  modelName?: string;
  modelSettings?: Record<string, unknown>;
  genericApiKey?: string | null;
  structuredCredentials?: Record<string, string> | null;
} = {}): ResolvedMediaModel {
  const genericApiKey = overrides.genericApiKey === undefined
    ? apiKey
    : overrides.genericApiKey;
  const structuredCredentials = overrides.structuredCredentials === undefined
    ? null
    : overrides.structuredCredentials;

  return {
    capability: overrides.capability ?? "DIGITAL_HUMAN_VIDEO",
    providerId: "tongyi-provider",
    providerName: "Alibaba Bailian",
    providerType: overrides.providerType ?? "TONGYI",
    providerConfigVersion: 0,
    baseUrl: null,
    providerSettings: {},
    modelId: "emo-model",
    modelDisplayName: "Alibaba EMO",
    modelName: overrides.modelName ?? "emo-v1",
    modelSettings: {
      model: "emo-v1",
      ratio: "1:1",
      styleLevel: "normal",
      ...overrides.modelSettings
    },
    temperature: 0,
    maxTokens: 0,
    timeoutMs: 120000,
    credentialEnvelopes: {
      apiKey: genericApiKey ? encryptSecret(genericApiKey, configSecret) : null,
      structured: structuredCredentials
        ? encryptCredentialMap(structuredCredentials, configSecret)
        : null
    }
  };
}

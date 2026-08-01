import { describe, expect, it } from "vitest";
import type { ResolvedMediaModel } from "@/lib/media/config";
import type { PrivateMediaStorage } from "@/lib/media/storage/types";
import {
  createVideoSpeechAsset,
  type VideoSpeechAssetDependencies,
  type VideoSpeechAssetRequest
} from "@/lib/media/video/speechAsset";

const baseRequest: VideoSpeechAssetRequest = {
  sessionId: "session-1",
  questionId: "question-1",
  question: "请简单介绍一下你自己。",
  stage: "WARM_UP",
  interviewerProfileId: "profile-1",
  behaviorSignals: null
};

describe("video speech asset creation", () => {
  it("varies style within the same stage when question intent and behavior signals change", async () => {
    const inputs: Array<{ instructions?: string; voice?: string }> = [];
    const deps = dependencies({
      streamPcm: async (_model, input) => {
        inputs.push(input);
        return pcmResult();
      }
    });

    await createVideoSpeechAsset(baseRequest, deps);
    await createVideoSpeechAsset({
      ...baseRequest,
      questionId: "question-2",
      question: "为什么这个关键项目最终失败了？",
      behaviorSignals: { hesitation: 0.91, needsEncouragement: true }
    }, deps);

    expect(inputs).toHaveLength(2);
    expect(inputs[0].instructions).not.toBe(inputs[1].instructions);
  });

  it("passes interviewer voice and style settings into styled TTS", async () => {
    const inputs: Array<{ instructions?: string; voice?: string; speed?: number }> = [];
    const deps = dependencies({
      findProfile: async () => ({
        id: "profile-1",
        voice: "interviewer_voice",
        styleJson: JSON.stringify({
          defaultInstruction: "保持耐心、专业的表达。",
          stageVoices: { WARM_UP: "warm_voice" },
          speed: 0.92
        }),
        enabled: true
      }),
      streamPcm: async (_model, input) => {
        inputs.push(input);
        return pcmResult();
      }
    });

    await createVideoSpeechAsset(baseRequest, deps);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ voice: "warm_voice", speed: 0.92 });
    expect(inputs[0].instructions).toContain("保持耐心、专业的表达。");
  });

  it("converts PCM16 mono bytes to a private RIFF/WAVE upload before persistence", async () => {
    let uploaded: Buffer | null = null;
    let persisted: Record<string, unknown> | null = null;
    const deps = dependencies({
      streamPcm: async () => pcmResult([
        Uint8Array.from([0x34, 0x12]),
        Uint8Array.from([0xfe, 0xff])
      ]),
      storage: storage({
        putObject: async (input) => {
          uploaded = input.body;
          expect(input.purpose).toBe("TTS_AUDIO");
          expect(input.contentType).toBe("audio/wav");
          return { objectKey: "media/audio/internal.wav", byteLength: input.body.byteLength };
        }
      }),
      persistAsset: async (input) => {
        persisted = input;
        return { id: "asset-1" };
      }
    });

    const result = await createVideoSpeechAsset(baseRequest, deps);

    expect(uploaded?.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(uploaded?.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(uploaded?.readUInt16LE(22)).toBe(1);
    expect(uploaded?.readUInt32LE(24)).toBe(48_000);
    expect(uploaded?.subarray(44)).toEqual(Buffer.from([0x34, 0x12, 0xfe, 0xff]));
    expect(persisted).toMatchObject({
      objectKey: "media/audio/internal.wav",
      mimeType: "audio/wav",
      byteLength: 48,
      purpose: "TTS_AUDIO"
    });
    expect(result).toEqual({
      assetId: "asset-1",
      mimeType: "audio/wav",
      byteLength: 48,
      sampleRate: 48_000,
      channels: 1
    });
    expect(result).not.toHaveProperty("objectKey");
    expect(result).not.toHaveProperty("url");
  });

  it("does not create signed read URLs while creating a speech asset", async () => {
    let readUrlCalls = 0;
    const deps = dependencies({
      storage: storage({
        createReadUrl: async () => {
          readUrlCalls += 1;
          return "https://signed.example/audio.wav?secret=1";
        }
      })
    });

    await createVideoSpeechAsset(baseRequest, deps);

    expect(readUrlCalls).toBe(0);
  });

  it.each([
    ["empty session", { sessionId: " " }],
    ["empty question id", { questionId: " " }],
    ["empty question", { question: " " }],
    ["empty stage", { stage: " " }],
    ["empty profile", { interviewerProfileId: " " }]
  ])("rejects %s before any billable or persistence boundary", async (_name, override) => {
    const calls = { model: 0, profile: 0, tts: 0, upload: 0, persist: 0 };
    const deps = dependencies({
      resolveTtsModel: async () => { calls.model += 1; return model(); },
      findProfile: async () => { calls.profile += 1; return profile(); },
      streamPcm: async () => { calls.tts += 1; return pcmResult(); },
      storage: storage({
        putObject: async () => {
          calls.upload += 1;
          return { objectKey: "unused", byteLength: 0 };
        }
      }),
      persistAsset: async () => { calls.persist += 1; return { id: "unused" }; }
    });

    await expect(createVideoSpeechAsset({ ...baseRequest, ...override }, deps))
      .rejects.toMatchObject({ code: "VIDEO_SPEECH_INPUT_INVALID" });
    expect(calls).toEqual({ model: 0, profile: 0, tts: 0, upload: 0, persist: 0 });
  });

  it("rejects a non-PCM stream result before upload or persistence", async () => {
    let uploadCalls = 0;
    let persistCalls = 0;
    const deps = dependencies({
      streamPcm: async () => ({ ...pcmResult(), encoding: "opus" as "pcm_s16le" }),
      storage: storage({
        putObject: async () => {
          uploadCalls += 1;
          return { objectKey: "unused", byteLength: 0 };
        }
      }),
      persistAsset: async () => { persistCalls += 1; return { id: "unused" }; }
    });

    await expect(createVideoSpeechAsset(baseRequest, deps)).rejects.toMatchObject({
      code: "VIDEO_SPEECH_PCM_REQUIRED"
    });
    expect(uploadCalls).toBe(0);
    expect(persistCalls).toBe(0);
  });

  it("compensates the private upload when persistence fails", async () => {
    const removed: string[] = [];
    const deps = dependencies({
      storage: storage({ removeObject: async (key) => { removed.push(key); } }),
      persistAsset: async () => { throw new Error("database unavailable secret"); }
    });

    await expect(createVideoSpeechAsset(baseRequest, deps)).rejects.toThrow();
    expect(removed).toEqual(["media/audio/test.wav"]);
  });
});

function dependencies(
  overrides: Partial<VideoSpeechAssetDependencies> = {}
): VideoSpeechAssetDependencies {
  return {
    resolveTtsModel: async () => model(),
    findProfile: async () => profile(),
    streamPcm: async () => pcmResult(),
    storageConfigId: "storage-1",
    storage: storage(),
    persistAsset: async () => ({ id: "asset-1" }),
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    ...overrides
  };
}

function profile() {
  return {
    id: "profile-1",
    voice: "interviewer_voice",
    styleJson: "{}",
    enabled: true
  };
}

function storage(
  overrides: Partial<PrivateMediaStorage> = {}
): PrivateMediaStorage {
  return {
    putObject: async (input) => ({
      objectKey: "media/audio/test.wav",
      byteLength: input.body.byteLength
    }),
    createReadUrl: async () => "https://signed.example/internal",
    removeObject: async () => undefined,
    ...overrides
  };
}

function pcmResult(chunks: Uint8Array[] = [Uint8Array.from([1, 0, 2, 0])]) {
  return {
    provider: "Alibaba Bailian",
    model: "qwen-audio-3.0-tts-flash",
    mode: "ALIBABA_TTS",
    traceId: "trace-tts",
    fallbackUsed: false,
    encoding: "pcm_s16le" as const,
    sampleRate: 48_000 as const,
    channels: 1 as const,
    chunks: (async function* () {
      for (const chunk of chunks) yield chunk;
    })()
  };
}

function model(): ResolvedMediaModel {
  return {
    capability: "TEXT_TO_SPEECH",
    providerId: "tongyi-provider",
    providerName: "Alibaba Bailian",
    providerType: "TONGYI",
    providerConfigVersion: 0,
    baseUrl: null,
    providerSettings: {},
    modelId: "tts-model",
    modelDisplayName: "Qwen Audio TTS",
    modelName: "qwen-audio-3.0-tts-flash",
    modelSettings: { instruction: "默认面试官风格。" },
    temperature: 0,
    maxTokens: 0,
    timeoutMs: 45_000,
    credentialEnvelopes: { apiKey: null, structured: null }
  };
}

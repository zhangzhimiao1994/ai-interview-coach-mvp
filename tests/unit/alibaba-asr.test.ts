import { describe, expect, it } from "vitest";
import {
  buildAlibabaAsrUrl,
  parseAlibabaAsrClientEvent,
  parseAlibabaAsrEvent,
  resolveAlibabaAsrAudioConfig
} from "@/lib/media/providers/alibabaAsr";
import { resolveAlibabaAsrCredentials } from "@/lib/media/providers/alibabaCredentials";
import {
  encryptCredentialMap,
  encryptSecret
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";

const configSecret = "alibaba-asr-test-config-secret";

function resolvedAsrModel(): ResolvedMediaModel {
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
    modelName: "qwen3-asr-flash-realtime-2026-02-10",
    modelSettings: {
      language: "zh-CN",
      sampleRate: 16000,
      encoding: "pcm"
    },
    temperature: 0,
    maxTokens: 1000,
    timeoutMs: 30_000,
    credentialEnvelopes: {
      apiKey: encryptSecret("main-api-key-sentinel", configSecret),
      structured: encryptCredentialMap(
        { asrApiKey: "asr-api-key-sentinel" },
        configSecret
      )
    }
  };
}

describe("Alibaba Qwen realtime ASR protocol", () => {
  it("builds the current workspace endpoint from editable database configuration", () => {
    expect(
      buildAlibabaAsrUrl({
        workspaceId: "ws-1",
        region: "cn-beijing",
        modelName: "qwen3-asr-flash-realtime-2026-02-10"
      })
    ).toBe(
      "wss://ws-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime-2026-02-10"
    );
  });

  it("rejects regions outside Alibaba's documented realtime endpoints", () => {
    expect(() =>
      buildAlibabaAsrUrl({
        workspaceId: "ws-1",
        region: "attacker.example.com",
        modelName: "qwen3-asr-flash-realtime"
      })
    ).toThrow(/region/i);
  });

  it("maps only safe transcript lifecycle events", () => {
    expect(
      parseAlibabaAsrEvent(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.text",
          text: "今天天气",
          stash: "很好"
        })
      )
    ).toEqual({ type: "partial", text: "今天天气很好" });

    expect(
      parseAlibabaAsrEvent(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "今天天气很好。"
        })
      )
    ).toEqual({ type: "final", text: "今天天气很好。" });

    expect(parseAlibabaAsrEvent('{"type":"session.created"}')).toEqual({
      type: "ready"
    });
    expect(parseAlibabaAsrEvent('{"type":"session.updated"}')).toBeNull();
    expect(parseAlibabaAsrEvent('{"type":"session.finished"}')).toEqual({
      type: "finished"
    });
    expect(
      parseAlibabaAsrEvent(
        JSON.stringify({ type: "unknown.vendor.event", secret: "do-not-forward" })
      )
    ).toBeNull();
  });

  it("redacts upstream error messages before forwarding them", () => {
    const result = parseAlibabaAsrEvent(
      JSON.stringify({
        type: "error",
        error: {
          code: "invalid_value",
          message: "request included asr-api-key-sentinel"
        }
      })
    );

    expect(result).toEqual({
      type: "error",
      code: "invalid_value",
      message: "语音识别服务返回错误。",
      retryable: false
    });
    expect(JSON.stringify(result)).not.toContain("asr-api-key-sentinel");
  });

  it("accepts only the documented client event subset", () => {
    const update = {
      event_id: "event-1",
      type: "session.update",
      session: {
        input_audio_format: "pcm",
        sample_rate: 16000,
        input_audio_transcription: { language: "zh" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.2,
          silence_duration_ms: 800
        }
      }
    };

    expect(parseAlibabaAsrClientEvent(JSON.stringify(update))).toEqual(update);
    expect(
      parseAlibabaAsrClientEvent(
        JSON.stringify({ ...update, authorization: "asr-api-key-sentinel" })
      )
    ).toBeNull();
    expect(
      parseAlibabaAsrClientEvent(
        JSON.stringify({
          event_id: "event-2",
          type: "input_audio_buffer.append",
          audio: "not canonical base64!"
        })
      )
    ).toBeNull();
    expect(
      parseAlibabaAsrClientEvent(
        JSON.stringify({ event_id: "event-3", type: "response.create" })
      )
    ).toBeNull();
  });

  it("normalizes editable model audio settings to Alibaba protocol values", () => {
    expect(resolveAlibabaAsrAudioConfig(resolvedAsrModel())).toEqual({
      encoding: "pcm",
      sampleRate: 16000,
      channels: 1,
      language: "zh"
    });
  });

  it("rejects Opus until the browser capture path implements Opus encoding", () => {
    const model = resolvedAsrModel();
    model.modelSettings.encoding = "opus";

    expect(() => resolveAlibabaAsrAudioConfig(model)).toThrow(
      expect.objectContaining({ code: "ALIBABA_ASR_ENCODING_INVALID" })
    );
  });
});

describe("Alibaba ASR credential resolution", () => {
  it("uses the ASR-specific key and public workspace settings", () => {
    const credentials = resolveAlibabaAsrCredentials(
      resolvedAsrModel(),
      () => configSecret
    );

    expect(credentials).toEqual({
      apiKey: "asr-api-key-sentinel",
      workspaceId: "ws-main",
      region: "cn-beijing"
    });
  });

  it("fails safely when required workspace configuration is absent", () => {
    const model = resolvedAsrModel();
    model.providerSettings = { region: "cn-beijing" };

    const error = (() => {
      try {
        resolveAlibabaAsrCredentials(model, () => configSecret);
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toMatchObject({
      name: "MediaConfigurationError",
      code: "ALIBABA_WORKSPACE_REQUIRED"
    });
    expect(JSON.stringify(error)).not.toContain("asr-api-key-sentinel");
    expect(JSON.stringify(error)).not.toContain("main-api-key-sentinel");
  });
});

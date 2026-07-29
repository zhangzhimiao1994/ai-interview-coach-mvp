import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptCredentialMap,
  encryptSecret
} from "@/lib/domain/aiServices";

const {
  findFirst,
  findUnique,
  runtimeFindUnique,
  createLingmouProvider,
  createSession,
  closeSession,
  enqueueProviderSessionCloseRecovery,
  createProviderSessionCloseRecoveryClaim,
  renewProviderSessionCloseRecoveryClaim,
  persistProviderSessionCloseRecoveryIdentity,
  attachProviderSessionCloseRecovery,
  releaseProviderSessionCloseRecovery
} =
  vi.hoisted(() => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    runtimeFindUnique: vi.fn(),
    createLingmouProvider: vi.fn(),
    createSession: vi.fn(),
    closeSession: vi.fn(),
    enqueueProviderSessionCloseRecovery: vi.fn(),
    createProviderSessionCloseRecoveryClaim: vi.fn(),
    renewProviderSessionCloseRecoveryClaim: vi.fn(),
    persistProviderSessionCloseRecoveryIdentity: vi.fn(),
    attachProviderSessionCloseRecovery: vi.fn(),
    releaseProviderSessionCloseRecovery: vi.fn()
  }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    aiModelConfig: { findFirst, findUnique },
    aiRuntimeSetting: { findUnique: runtimeFindUnique }
  }
}));
vi.mock("@/lib/media/providers/lingmou", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/media/providers/lingmou")
  >();
  return { ...actual, createLingmouProvider };
});
vi.mock("@/lib/media/providerSessionCloseRecoveries", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/media/providerSessionCloseRecoveries")
  >();
  return {
    ...actual,
    enqueueProviderSessionCloseRecovery,
    createProviderSessionCloseRecoveryClaim,
    renewProviderSessionCloseRecoveryClaim,
    persistProviderSessionCloseRecoveryIdentity,
    attachProviderSessionCloseRecovery,
    releaseProviderSessionCloseRecovery
  };
});

import {
  diagnoseAiCapability,
  findDiagnosticModel,
  getAllAiDiagnostics,
  probeLingmouModel
} from "@/lib/ai/diagnostics";
import { aiCapabilities, type AiCapability } from "@/lib/domain/aiServiceConstants";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { LingmouSessionRecoveryError } from "@/lib/media/providers/lingmou";

const configSecret = "unit-test-ai-config-secret";

describe("AI configuration diagnostics", () => {
  beforeEach(() => {
    findFirst.mockReset();
    findUnique.mockReset();
    runtimeFindUnique.mockReset().mockResolvedValue(null);
    createSession.mockReset();
    closeSession.mockReset();
    createLingmouProvider.mockReset();
    enqueueProviderSessionCloseRecovery.mockReset();
    createProviderSessionCloseRecoveryClaim.mockReset();
    renewProviderSessionCloseRecoveryClaim.mockReset();
    persistProviderSessionCloseRecoveryIdentity.mockReset();
    attachProviderSessionCloseRecovery.mockReset();
    releaseProviderSessionCloseRecovery.mockReset();
    createLingmouProvider.mockReturnValue({ createSession, closeSession });
    closeSession.mockResolvedValue(undefined);
    enqueueProviderSessionCloseRecovery.mockResolvedValue({
      id: "fallback-recovery-1"
    });
    createProviderSessionCloseRecoveryClaim.mockResolvedValue({ id: "claim-1" });
    renewProviderSessionCloseRecoveryClaim.mockResolvedValue(undefined);
    persistProviderSessionCloseRecoveryIdentity.mockResolvedValue({
      owner: "CLAIM",
      attachFailed: false
    });
    attachProviderSessionCloseRecovery.mockResolvedValue(undefined);
    releaseProviderSessionCloseRecovery.mockResolvedValue(undefined);
  });

  it("queries only the current selection and never the recommendation flag", async () => {
    findFirst.mockResolvedValue(null);

    await findDiagnosticModel("INTERVIEW_DIALOGUE");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        capability: "INTERVIEW_DIALOGUE",
        isSelected: true
      },
      include: { provider: true }
    });
    expect(JSON.stringify(findFirst.mock.calls[0][0])).not.toContain("isDefault");
  });

  it.each([
    ["no selected model", null, "NOT_SELECTED", "MODEL_NOT_SELECTED"],
    [
      "disabled model",
      selectedModel({ modelOverrides: { enabled: false } }),
      "MISCONFIGURED",
      "MODEL_DISABLED"
    ],
    [
      "disabled provider",
      selectedModel({ providerOverrides: { enabled: false } }),
      "MISCONFIGURED",
      "PROVIDER_DISABLED"
    ]
  ])("diagnoses %s", async (_name, model, status, code) => {
    const deps = dependencies(model);

    const result = await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
      liveCheck: false,
      dependencies: deps
    });

    expect(result).toMatchObject({ status, code, checkMode: "CONFIG" });
    expect(deps.probeLingmouModel).not.toHaveBeenCalled();
  });

  it("checks configuration without starting a paid text request", async () => {
    const deps = dependencies(selectedModel());

    const result = await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
      liveCheck: false,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      code: "CONFIG_VALID",
      checkMode: "CONFIG",
      providerName: "Alibaba Cloud",
      modelDisplayName: "Qwen Plus",
      modelName: "qwen-plus"
    });
    expect(deps.probeLingmouModel).not.toHaveBeenCalled();
  });

  it("reports a covered capability as valid when it is routed through an Omni takeover model", async () => {
    const deps = dependencies(selectedModel({
      capability: "INTERVIEW_FOLLOW_UP",
      modelOverrides: {
        id: "model-omni",
        displayName: "Qwen Omni",
        modelName: "qwen3.5-omni-plus"
      }
    }));

    const result = await diagnoseAiCapability("VISION_BEHAVIOR_ANALYSIS", {
      liveCheck: false,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      code: "MULTIMODAL_TAKEOVER_ENABLED",
      providerName: "Alibaba Cloud",
      modelDisplayName: "Qwen Omni",
      modelName: "qwen3.5-omni-plus"
    });
    expect(deps.probeTextModel).not.toHaveBeenCalled();
  });

  it("runs a minimum live text check with decrypted credentials only in memory", async () => {
    const model = selectedModel();
    const deps = dependencies(model);

    const result = await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
      liveCheck: true,
      dependencies: deps
    });

    expect(deps.probeTextModel).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-main-secret",
      modelName: "qwen-plus",
      temperature: 0.4,
      maxTokens: 1200,
      timeoutMs: 30000
    }));
    expect(result).toMatchObject({
      status: "AVAILABLE",
      code: "LIVE_CHECK_SUCCEEDED",
      checkMode: "LIVE"
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-main-secret");
    expect(serialized).not.toContain(model.provider.apiKeyCiphertext);
    expect(serialized).not.toContain(model.provider.apiKeyIv);
    expect(serialized).not.toContain(model.provider.apiKeyTag);
  });

  it("disables DeepSeek thinking mode during the minimum live text check", async () => {
    const deps = dependencies(selectedModel({
      modelOverrides: { modelName: "deepseek-v4-pro" },
      providerOverrides: {
        providerType: "DEEPSEEK",
        baseUrl: "https://api.deepseek.com"
      }
    }));

    await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
      liveCheck: true,
      dependencies: deps
    });

    expect(deps.probeTextModel).toHaveBeenCalledWith(expect.objectContaining({
      thinkingMode: "disabled"
    }));
  });

  it("maps a failed live text check without exposing the upstream response", async () => {
    const deps = dependencies(selectedModel(), {
      probeResult: {
        ok: false,
        code: "AUTHENTICATION_FAILED",
        message: "认证失败，请检查服务商凭据。"
      }
    });

    const result = await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
      liveCheck: true,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "UNREACHABLE",
      code: "AUTHENTICATION_FAILED",
      message: "认证失败，请检查服务商凭据。"
    });
    expect(JSON.stringify(result)).not.toContain("upstream");
  });

  it.each([
    [
      "malformed provider settings",
      selectedModel({ providerSettingsJson: "{provider-settings-secret-sentinel" }),
      "INVALID_PROVIDER_SETTINGS",
      "provider-settings-secret-sentinel"
    ],
    [
      "malformed model settings",
      selectedModel({ modelSettingsJson: "{model-settings-secret-sentinel" }),
      "INVALID_MODEL_SETTINGS",
      "model-settings-secret-sentinel"
    ],
    [
      "partial API key envelope",
      selectedModel({
        providerOverrides: {
          apiKeyCiphertext: "ciphertext-secret-sentinel",
          apiKeyIv: null,
          apiKeyTag: null
        }
      }),
      "INVALID_CREDENTIAL_ENVELOPE",
      "ciphertext-secret-sentinel"
    ]
  ])("returns a safe result for %s", async (_name, model, code, sentinel) => {
    const result = await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
      liveCheck: false,
      dependencies: dependencies(model)
    });

    expect(result).toMatchObject({ status: "MISCONFIGURED", code });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("accepts an Alibaba ASR-specific API key and required audio settings", async () => {
    const model = selectedModel({
      capability: "SPEECH_TO_TEXT",
      apiKey: null,
      credentials: { asrApiKey: "asr-secret-sentinel" },
      providerSettings: {
        workspaceId: "ws-main",
        region: "cn-beijing"
      },
      modelSettings: {
        language: "zh-CN",
        sampleRate: 16000,
        encoding: "pcm"
      }
    });
    const deps = dependencies(model);

    const result = await diagnoseAiCapability("SPEECH_TO_TEXT", {
      liveCheck: true,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      code: "LIVE_CHECK_REQUIRES_AUDIO"
    });
    expect(deps.probeTextModel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("asr-secret-sentinel");
  });

  it("rejects Opus while realtime browser capture only produces PCM", async () => {
    const model = selectedModel({
      capability: "SPEECH_TO_TEXT",
      apiKey: "main-asr-secret",
      providerSettings: {
        workspaceId: "ws-main",
        region: "cn-beijing"
      },
      modelSettings: {
        language: "zh-CN",
        sampleRate: 16000,
        encoding: "opus"
      }
    });

    const result = await diagnoseAiCapability("SPEECH_TO_TEXT", {
      liveCheck: false,
      dependencies: dependencies(model)
    });

    expect(result).toMatchObject({
      status: "MISCONFIGURED",
      code: "MISSING_REQUIRED_CONFIGURATION"
    });
    expect(result.message).toContain("PCM");
  });

  it("requires the Alibaba workspace endpoint before enabling realtime ASR", async () => {
    const model = selectedModel({
      capability: "SPEECH_TO_TEXT",
      apiKey: "main-asr-secret",
      providerSettings: { region: "cn-beijing" },
      modelSettings: {
        language: "zh-CN",
        sampleRate: 16000,
        encoding: "pcm"
      }
    });

    const result = await diagnoseAiCapability("SPEECH_TO_TEXT", {
      liveCheck: false,
      dependencies: dependencies(model)
    });

    expect(result).toMatchObject({
      status: "MISCONFIGURED",
      code: "MISSING_REQUIRED_CONFIGURATION"
    });
    expect(result.message).toContain("Workspace ID");
  });

  it("does not require an unused HTTP Base URL for Alibaba realtime ASR", async () => {
    const model = selectedModel({
      capability: "SPEECH_TO_TEXT",
      credentials: { asrApiKey: "asr-secret" },
      providerSettings: {
        workspaceId: "ws-main",
        region: "cn-beijing"
      },
      modelSettings: {
        language: "zh-CN",
        sampleRate: 16000,
        encoding: "pcm"
      },
      providerOverrides: { baseUrl: null }
    });

    const result = await diagnoseAiCapability("SPEECH_TO_TEXT", {
      liveCheck: false,
      dependencies: dependencies(model)
    });

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      code: "ADAPTER_AVAILABLE"
    });
  });

  it("does not report a non-Alibaba speech model as an available realtime adapter", async () => {
    const deps = dependencies(selectedModel({
      capability: "SPEECH_TO_TEXT",
      providerOverrides: { providerType: "OPENAI_COMPATIBLE" }
    }));

    const result = await diagnoseAiCapability("SPEECH_TO_TEXT", {
      liveCheck: true,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "CONFIGURED_NOT_ADAPTED",
      code: "ADAPTER_NOT_IMPLEMENTED"
    });
    expect(deps.probeTextModel).not.toHaveBeenCalled();
  });

  it("requires every Alibaba TTS setting", async () => {
    const result = await diagnoseAiCapability("TEXT_TO_SPEECH", {
      liveCheck: false,
      dependencies: dependencies(selectedModel({
        capability: "TEXT_TO_SPEECH",
        modelSettings: { sampleRate: 24000, format: "pcm" },
        modelOverrides: { modelName: "cosyvoice-v3-flash" }
      }))
    });

    expect(result).toMatchObject({
      status: "MISCONFIGURED",
      code: "MISSING_REQUIRED_CONFIGURATION"
    });
    expect(result.message).toContain("音色");
  });

  it("accepts an Alibaba HTTP TTS adapter with a dedicated key and no Base URL", async () => {
    const deps = dependencies(selectedModel({
      capability: "TEXT_TO_SPEECH",
      apiKey: null,
      credentials: { ttsApiKey: "tts-secret-sentinel" },
      providerSettings: {
        workspaceId: "ws-main",
        region: "cn-beijing"
      },
      modelSettings: { voice: "longanhuan", format: "pcm", sampleRate: 48000, channels: 1 },
      modelOverrides: { modelName: "cosyvoice-v3-flash" },
      providerOverrides: { baseUrl: null }
    }));

    const result = await diagnoseAiCapability("TEXT_TO_SPEECH", {
      liveCheck: true,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      code: "LIVE_CHECK_REQUIRES_TEXT"
    });
    expect(deps.probeTextModel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("tts-secret-sentinel");
  });

  it("rejects non-CosyVoice models for the HTTP playback adapter", async () => {
    const result = await diagnoseAiCapability("TEXT_TO_SPEECH", {
      liveCheck: false,
      dependencies: dependencies(selectedModel({
        capability: "TEXT_TO_SPEECH",
        providerSettings: {
          workspaceId: "ws-main",
          region: "cn-beijing"
        },
        modelSettings: { voice: "longanhuan", format: "pcm", sampleRate: 48000, channels: 1 },
        modelOverrides: {
          modelName: "qwen3-tts-instruct-flash-realtime"
        },
        providerOverrides: { baseUrl: null }
      }))
    });

    expect(result).toMatchObject({
      status: "MISCONFIGURED",
      code: "ALIBABA_TTS_MODEL_INVALID"
    });
    expect(result.message).toContain("模型名称无效");
  });

  it("uses the runtime Workspace ID validation in Alibaba TTS diagnostics", async () => {
    const result = await diagnoseAiCapability("TEXT_TO_SPEECH", {
      liveCheck: false,
      dependencies: dependencies(selectedModel({
        capability: "TEXT_TO_SPEECH",
        providerSettings: {
          workspaceId: "invalid.workspace.example.com",
          region: "cn-beijing"
        },
        modelSettings: { voice: "longanhuan", format: "pcm", sampleRate: 48000, channels: 1 },
        modelOverrides: { modelName: "cosyvoice-v3-flash" },
        providerOverrides: { baseUrl: null }
      }))
    });

    expect(result).toMatchObject({
      status: "MISCONFIGURED",
      code: "MISSING_REQUIRED_CONFIGURATION"
    });
    expect(result.message).toContain("Workspace ID");
  });

  it("treats a non-Lingmou realtime avatar selection as not configured", async () => {
    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: false,
      dependencies: dependencies(selectedModel({
        capability: "DIGITAL_HUMAN_REALTIME",
        credentials: { rtcAppKey: "rtc-secret-sentinel" },
        providerSettings: { rtcAppId: "rtc-app-id" },
        modelSettings: { avatarId: "avatar-id", rtcMode: "web" }
      }))
    });

    expect(result).toMatchObject({
      status: "NOT_CONFIGURED",
      code: "LINGMOU_NOT_CONFIGURED"
    });
    expect(result.message).toBe("灵眸未配置，当前使用本地数字人");
    expect(JSON.stringify(result)).not.toContain("rtc-secret-sentinel");
  });

  it("reports no selected realtime Lingmou model as not configured", async () => {
    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: false,
      dependencies: dependencies(null)
    });

    expect(result).toMatchObject({
      status: "NOT_CONFIGURED",
      code: "LINGMOU_NOT_CONFIGURED",
      message: "灵眸未配置，当前使用本地数字人"
    });
  });

  it.each([
    ["AccessKey ID", { accessKeyId: "", accessKeySecret: "lingmou-ak-secret" }, {}, {}],
    ["AccessKey Secret", { accessKeyId: "lingmou-ak-id", accessKeySecret: "" }, {}, {}],
    ["region", completeLingmouCredentials(), { region: "cn-shanghai" }, {}],
    ["config ID", completeLingmouCredentials(), {}, { configId: "" }],
    ["instance ID", completeLingmouCredentials(), {}, { instanceId: "" }],
    ["cloud rendering", completeLingmouCredentials(), {}, { renderMode: "client" }],
    ["audio-driven integration", completeLingmouCredentials(), {}, { integrationMode: "text-driven" }],
    ["web client", completeLingmouCredentials(), {}, { client: "native" }]
  ])("reports a Lingmou model with invalid %s as not configured", async (
    _field,
    credentials,
    providerSettings,
    modelSettings
  ) => {
    const deps = dependencies(selectedLingmouModel({
      credentials,
      providerSettings,
      modelSettings
    }));
    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: false,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "NOT_CONFIGURED",
      code: "LINGMOU_NOT_CONFIGURED",
      message: "灵眸未配置，当前使用本地数字人"
    });
    expect(deps.probeTextModel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("lingmou-ak-secret");
  });

  it("reports the wrong Lingmou adapter model as not configured without a probe", async () => {
    const deps = dependencies(selectedLingmouModel({
      modelName: "another-lingmou-model"
    }));

    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: true,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "NOT_CONFIGURED",
      code: "LINGMOU_NOT_CONFIGURED",
      message: "灵眸未配置，当前使用本地数字人"
    });
    expect(deps.probeTextModel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("lingmou-ak-secret");
  });

  it("validates complete Lingmou configuration without a paid session by default", async () => {
    const deps = dependencies(selectedLingmouModel());

    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: false,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      checkMode: "CONFIG",
      code: "ADAPTER_AVAILABLE"
    });
    expect(deps.probeLingmouModel).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("lingmou-ak-id");
    expect(serialized).not.toContain("lingmou-ak-secret");
  });

  it("runs the Lingmou paid probe only for an explicit live check", async () => {
    const deps = dependencies(selectedLingmouModel(), {
      lingmouProbeResult: {
        ok: true,
        code: "LIVE_AVAILABLE",
        message: "灵眸真实会话创建并关闭成功。"
      }
    });

    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: true,
      dependencies: deps
    });

    expect(deps.probeLingmouModel).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "LIVE_AVAILABLE",
      checkMode: "LIVE",
      code: "LIVE_AVAILABLE"
    });
    expect(JSON.stringify(result)).not.toContain("lingmou-ak-secret");
  });

  it("maps a Lingmou paid probe failure to LIVE_FAILED with a safe code", async () => {
    const deps = dependencies(selectedLingmouModel(), {
      lingmouProbeResult: {
        ok: false,
        code: "LINGMOU_LIVE_CLOSE_FAILED",
        message: "灵眸真实检查失败。"
      }
    });

    const result = await diagnoseAiCapability("DIGITAL_HUMAN_REALTIME", {
      liveCheck: true,
      dependencies: deps
    });

    expect(result).toMatchObject({
      status: "LIVE_FAILED",
      code: "LINGMOU_LIVE_CLOSE_FAILED"
    });
    expect(JSON.stringify(result)).not.toContain("lingmou-ak-secret");
  });

  it("creates, validates, and immediately closes a Lingmou live probe session", async () => {
    createSession.mockResolvedValue({
      providerSessionId: "provider-session-id",
      connection: lingmouConnection()
    });

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toEqual({
      ok: true,
      code: "LIVE_AVAILABLE",
      message: "灵眸真实会话创建并关闭成功。"
    });
    expect(closeSession).toHaveBeenCalledWith("provider-session-id");
    expect(createProviderSessionCloseRecoveryClaim).toHaveBeenCalledWith({
      providerId: "provider-1",
      instanceId: "instance-id",
      providerConfigVersion: 1,
      reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
      leaseMs: 60_000
    });
    expect(attachProviderSessionCloseRecovery).toHaveBeenCalledWith(
      "claim-1",
      "provider-session-id",
      "DIAGNOSTIC_LIVE_OPERATION"
    );
    expect(releaseProviderSessionCloseRecovery).toHaveBeenCalledWith("claim-1");
    expect(createProviderSessionCloseRecoveryClaim.mock.invocationCallOrder[0]).toBeLessThan(
      createSession.mock.invocationCallOrder[0]!
    );
  });

  it("makes no paid create call when the diagnostic live-operation claim fails", async () => {
    createProviderSessionCloseRecoveryClaim.mockRejectedValue(
      new Error("raw database secret sentinel")
    );

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({
      ok: false,
      code: "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED"
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret sentinel");
  });

  it("renews a live-operation claim while paid creation is pending and clears its timer", async () => {
    vi.useFakeTimers();
    let finishCreate: ((value: unknown) => void) | undefined;
    createSession.mockImplementation(
      () => new Promise((resolve) => { finishCreate = resolve; })
    );

    try {
      const pending = probeLingmouModel(resolvedLingmouModel());
      await Promise.resolve();
      await Promise.resolve();
      expect(createSession).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(20_000);
      expect(renewProviderSessionCloseRecoveryClaim).toHaveBeenCalledWith(
        "claim-1",
        60_000
      );

      finishCreate?.({
        providerSessionId: "provider-session-id",
        connection: lingmouConnection()
      });
      await expect(pending).resolves.toMatchObject({ ok: true });
      const renewalsAfterSettlement =
        renewProviderSessionCloseRecoveryClaim.mock.calls.length;

      await vi.advanceTimersByTimeAsync(60_000);
      expect(renewProviderSessionCloseRecoveryClaim).toHaveBeenCalledTimes(
        renewalsAfterSettlement
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a settled live diagnostic successful when a boundary renewal rejects", async () => {
    vi.useFakeTimers();
    let finishCreate: ((value: unknown) => void) | undefined;
    let rejectRenewal: ((reason?: unknown) => void) | undefined;
    createSession.mockImplementation(
      () => new Promise((resolve) => { finishCreate = resolve; })
    );
    renewProviderSessionCloseRecoveryClaim.mockImplementation(
      () => new Promise<void>((_resolve, reject) => { rejectRenewal = reject; })
    );

    try {
      const pending = probeLingmouModel(resolvedLingmouModel());
      await Promise.resolve();
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(20_000);
      expect(renewProviderSessionCloseRecoveryClaim).toHaveBeenCalledOnce();

      finishCreate?.({
        providerSessionId: "provider-session-id",
        connection: lingmouConnection()
      });
      await vi.waitFor(() => {
        expect(attachProviderSessionCloseRecovery).toHaveBeenCalledWith(
          "claim-1",
          "provider-session-id",
          "DIAGNOSTIC_LIVE_OPERATION"
        );
      });
      rejectRenewal?.(new Error("claim already attached"));

      await expect(pending).resolves.toMatchObject({
        ok: true,
        code: "LIVE_AVAILABLE"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the diagnostic claim when paid creation produces no session", async () => {
    createSession.mockRejectedValue(new Error("raw create secret sentinel"));

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({ ok: false, code: "LINGMOU_LIVE_CREATE_FAILED" });
    expect(releaseProviderSessionCloseRecovery).toHaveBeenCalledWith("claim-1");
    expect(attachProviderSessionCloseRecovery).not.toHaveBeenCalled();
  });

  it("closes an invalid Lingmou probe DTO and returns only a safe failure code", async () => {
    createSession.mockResolvedValue({
      providerSessionId: "provider-session-id",
      connection: { ...lingmouConnection(), token: "" }
    });

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({
      ok: false,
      code: "LINGMOU_LIVE_INVALID_RESPONSE"
    });
    expect(closeSession).toHaveBeenCalledWith("provider-session-id");
    expect(JSON.stringify(result)).not.toContain("secret sentinel");
  });

  it("maps Lingmou live create and close failures without exposing raw errors", async () => {
    createSession.mockRejectedValueOnce(new Error("raw create secret sentinel"));
    const createFailure = await probeLingmouModel(resolvedLingmouModel());

    expect(createFailure).toMatchObject({
      ok: false,
      code: "LINGMOU_LIVE_CREATE_FAILED"
    });
    expect(closeSession).not.toHaveBeenCalled();
    expect(releaseProviderSessionCloseRecovery).toHaveBeenCalledWith("claim-1");
    releaseProviderSessionCloseRecovery.mockClear();

    createSession.mockResolvedValueOnce({
      providerSessionId: "provider-session-id",
      connection: lingmouConnection()
    });
    closeSession.mockRejectedValueOnce(new Error("raw close secret sentinel"));
    const closeFailure = await probeLingmouModel(resolvedLingmouModel());

    expect(closeFailure).toMatchObject({
      ok: false,
      code: "LINGMOU_LIVE_CLOSE_FAILED"
    });
    expect(attachProviderSessionCloseRecovery).toHaveBeenLastCalledWith(
      "claim-1",
      "provider-session-id",
      "DIAGNOSTIC_LIVE_OPERATION"
    );
    expect(releaseProviderSessionCloseRecovery).not.toHaveBeenCalled();
    expect(JSON.stringify([createFailure, closeFailure])).not.toContain(
      "secret sentinel"
    );
  });

  it("queues the upstream identity when invalid RTC compensation close fails", async () => {
    createSession.mockRejectedValue(
      new LingmouSessionRecoveryError("orphan-provider-session", "instance-id")
    );

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({
      ok: false,
      code: "LINGMOU_CREATE_COMPENSATION_CLOSE_FAILED"
    });
    expect(persistProviderSessionCloseRecoveryIdentity).toHaveBeenCalledWith(
      "claim-1",
      {
        providerId: "provider-1",
        providerSessionId: "orphan-provider-session",
        instanceId: "instance-id",
        providerConfigVersion: 1,
        reasonCode: "DIAGNOSTIC_CREATE_COMPENSATION_FAILED"
      },
      2
    );
    expect(releaseProviderSessionCloseRecovery).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("orphan-provider-session");
  });

  it("falls back durably when a compensation identity cannot attach twice", async () => {
    createSession.mockRejectedValue(
      new LingmouSessionRecoveryError("orphan-provider-session", "instance-id")
    );
    persistProviderSessionCloseRecoveryIdentity.mockResolvedValue({
      owner: "FALLBACK",
      attachFailed: true
    });

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({
      ok: false,
      code: "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED"
    });
    expect(persistProviderSessionCloseRecoveryIdentity).toHaveBeenCalledWith(
      "claim-1",
      {
        providerId: "provider-1",
        providerSessionId: "orphan-provider-session",
        instanceId: "instance-id",
        providerConfigVersion: 1,
        reasonCode: "DIAGNOSTIC_CREATE_COMPENSATION_FAILED"
      },
      2
    );
    expect(JSON.stringify(result)).not.toContain("orphan-provider-session");
  });

  it("persists a durable fallback when attach fails twice and close fails", async () => {
    createSession.mockResolvedValue({
      providerSessionId: "provider-session-id",
      connection: lingmouConnection()
    });
    closeSession.mockRejectedValue(new Error("raw close secret sentinel"));
    attachProviderSessionCloseRecovery.mockRejectedValue(
      new Error("raw database secret sentinel")
    );
    persistProviderSessionCloseRecoveryIdentity.mockResolvedValue({
      owner: "FALLBACK",
      attachFailed: true
    });

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({
      ok: false,
      code: "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED"
    });
    expect(attachProviderSessionCloseRecovery).toHaveBeenCalledOnce();
    expect(persistProviderSessionCloseRecoveryIdentity).toHaveBeenCalledWith(
      "claim-1",
      {
        providerId: "provider-1",
        providerSessionId: "provider-session-id",
        instanceId: "instance-id",
        providerConfigVersion: 1,
        reasonCode: "DIAGNOSTIC_LIVE_CLOSE_FAILED"
      },
      1
    );
    expect(JSON.stringify(result)).not.toContain("secret sentinel");
  });

  it("does not release the claim when ambiguous attach makes fallback upsert return that claim", async () => {
    createSession.mockResolvedValue({
      providerSessionId: "provider-session-id",
      connection: lingmouConnection()
    });
    closeSession.mockRejectedValue(new Error("raw close secret sentinel"));
    attachProviderSessionCloseRecovery.mockRejectedValue(
      new Error("commit acknowledged as failed")
    );
    persistProviderSessionCloseRecoveryIdentity.mockResolvedValue({
      owner: "CLAIM",
      attachFailed: true
    });

    const result = await probeLingmouModel(resolvedLingmouModel());

    expect(result).toMatchObject({
      ok: false,
      code: "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED"
    });
    expect(persistProviderSessionCloseRecoveryIdentity).toHaveBeenCalledOnce();
    expect(releaseProviderSessionCloseRecovery).not.toHaveBeenCalled();
  });

  it("validates Alibaba observable-behavior sampling ranges", async () => {
    const invalid = await diagnoseAiCapability("VISION_BEHAVIOR_ANALYSIS", {
      liveCheck: false,
      dependencies: dependencies(selectedModel({
        capability: "VISION_BEHAVIOR_ANALYSIS",
        modelSettings: {
          minimumConfidence: 1.5,
          frameIntervalMs: 1000,
          maxFrames: 12
        }
      }))
    });
    const valid = await diagnoseAiCapability("VISION_BEHAVIOR_ANALYSIS", {
      liveCheck: false,
      dependencies: dependencies(selectedModel({
        capability: "VISION_BEHAVIOR_ANALYSIS",
        modelSettings: {
          minimumConfidence: 0.6,
          frameIntervalMs: 1000,
          maxFrames: 12
        }
      }))
    });

    expect(invalid).toMatchObject({
      status: "MISCONFIGURED",
      code: "MISSING_REQUIRED_CONFIGURATION"
    });
    expect(valid).toMatchObject({
      status: "CONFIGURED_NOT_ADAPTED",
      code: "ADAPTER_NOT_IMPLEMENTED"
    });
  });

  it("returns one configuration-only summary for every supported capability", async () => {
    const findModel = vi.fn().mockResolvedValue(null);

    const results = await getAllAiDiagnostics({
      findModel,
      readConfigSecret: () => configSecret,
      probeTextModel: vi.fn(),
      probeLingmouModel: vi.fn()
    });

    expect(results).toHaveLength(aiCapabilities.length);
    expect(results.map((item) => item.capability)).toEqual(aiCapabilities);
    expect(results.every((item) => item.checkMode === "CONFIG")).toBe(true);
    expect(findModel).toHaveBeenCalledTimes(aiCapabilities.length);
  });
});

type SelectedModelOptions = {
  capability?: AiCapability;
  apiKey?: string | null;
  credentials?: Record<string, string>;
  providerSettings?: Record<string, unknown>;
  providerSettingsJson?: string;
  modelSettings?: Record<string, unknown>;
  modelSettingsJson?: string;
  modelOverrides?: Record<string, unknown>;
  providerOverrides?: Record<string, unknown>;
};

function selectedModel({
  capability = "INTERVIEW_DIALOGUE",
  apiKey = "sk-main-secret",
  credentials = {},
  providerSettings = {},
  providerSettingsJson,
  modelSettings = {},
  modelSettingsJson,
  modelOverrides = {},
  providerOverrides = {}
}: SelectedModelOptions = {}) {
  const encryptedApiKey = apiKey ? encryptSecret(apiKey, configSecret) : null;
  const encryptedCredentials = Object.keys(credentials).length > 0
    ? encryptCredentialMap(credentials, configSecret)
    : null;

  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "Qwen Plus",
    modelName: "qwen-plus",
    capability,
    temperature: 0.4,
    maxTokens: 1200,
    timeoutMs: 30000,
    settingsJson: modelSettingsJson ?? JSON.stringify(modelSettings),
    enabled: true,
    isDefault: false,
    isSelected: true,
    provider: {
      id: "provider-1",
      displayName: "Alibaba Cloud",
      providerType: "TONGYI",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      settingsJson: providerSettingsJson ?? JSON.stringify(providerSettings),
      enabled: true,
      apiKeyCiphertext: encryptedApiKey?.ciphertext ?? null,
      apiKeyIv: encryptedApiKey?.iv ?? null,
      apiKeyTag: encryptedApiKey?.tag ?? null,
      credentialsCiphertext: encryptedCredentials?.ciphertext ?? null,
      credentialsIv: encryptedCredentials?.iv ?? null,
      credentialsTag: encryptedCredentials?.tag ?? null,
      ...providerOverrides
    },
    ...modelOverrides
  };
}

function completeLingmouCredentials() {
  return {
    accessKeyId: "lingmou-ak-id",
    accessKeySecret: "lingmou-ak-secret"
  };
}

function selectedLingmouModel({
  credentials = completeLingmouCredentials(),
  providerSettings = {},
  modelSettings = {},
  modelName = "lingmou-2d-cloud-audio-driven"
}: {
  credentials?: Record<string, string>;
  providerSettings?: Record<string, unknown>;
  modelSettings?: Record<string, unknown>;
  modelName?: string;
} = {}) {
  return selectedModel({
    capability: "DIGITAL_HUMAN_REALTIME",
    apiKey: null,
    credentials,
    providerSettings: { region: "cn-beijing", ...providerSettings },
    modelSettings: {
      configId: "chat-config-id",
      instanceId: "paid-instance-id",
      renderMode: "cloud",
      integrationMode: "audio-driven",
      client: "web",
      ...modelSettings
    },
    modelOverrides: {
      displayName: "灵眸 2D 云渲染音频驱动数字人",
      modelName
    },
    providerOverrides: {
      displayName: "灵眸数字人",
      providerType: "LINGMOU",
      baseUrl: null
    }
  });
}

function dependencies(
  model: ReturnType<typeof selectedModel> | null,
  options: {
    probeResult?: Record<string, unknown>;
    lingmouProbeResult?: { ok: boolean; code: string; message: string };
  } = {}
) {
  return {
    findModel: vi.fn().mockResolvedValue(model),
    readConfigSecret: () => configSecret,
    probeTextModel: vi.fn().mockResolvedValue(options.probeResult ?? {
      ok: true,
      code: "LIVE_CHECK_SUCCEEDED",
      message: "真实连通测试通过。"
    }),
    probeLingmouModel: vi.fn().mockResolvedValue(options.lingmouProbeResult ?? {
      ok: true,
      code: "LIVE_AVAILABLE",
      message: "灵眸真实会话创建并关闭成功。"
    })
  };
}

function lingmouConnection() {
  return {
    appId: "rtc-app",
    avatarUserId: "avatar-user",
    channel: "rtc-channel",
    clientUserId: "client-user",
    serverUserId: "server-user",
    timestamp: 1_784_257_200,
    token: "short-lived-token",
    sessionId: "provider-session-id"
  };
}

function resolvedLingmouModel(): ResolvedMediaModel {
  return {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerId: "provider-1",
    providerName: "灵眸数字人",
    providerType: "LINGMOU",
    providerConfigVersion: 1,
    baseUrl: null,
    providerSettings: { region: "cn-beijing" },
    modelId: "model-1",
    modelDisplayName: "灵眸 2D 云渲染音频驱动数字人",
    modelName: "lingmou-2d-cloud-audio-driven",
    modelSettings: {
      configId: "config-id",
      instanceId: "instance-id",
      renderMode: "cloud",
      integrationMode: "audio-driven",
      client: "web"
    },
    temperature: 0.4,
    maxTokens: 1200,
    timeoutMs: 30_000,
    credentialEnvelopes: {
      apiKey: null,
      structured: { ciphertext: "ciphertext", iv: "iv", tag: "tag" }
    }
  };
}

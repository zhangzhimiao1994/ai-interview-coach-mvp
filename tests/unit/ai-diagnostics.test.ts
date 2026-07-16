import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptCredentialMap,
  encryptSecret
} from "@/lib/domain/aiServices";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    aiModelConfig: { findFirst }
  }
}));

import {
  diagnoseAiCapability,
  findDiagnosticModel,
  getAllAiDiagnostics
} from "@/lib/ai/diagnostics";
import { aiCapabilities, type AiCapability } from "@/lib/domain/aiServiceConstants";

const configSecret = "unit-test-ai-config-secret";

describe("AI configuration diagnostics", () => {
  beforeEach(() => {
    findFirst.mockReset();
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
    expect(deps.probeTextModel).not.toHaveBeenCalled();
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
        modelSettings: { sampleRate: 24000, format: "pcm" }
      }))
    });

    expect(result).toMatchObject({
      status: "MISCONFIGURED",
      code: "MISSING_REQUIRED_CONFIGURATION"
    });
    expect(result.message).toContain("音色");
  });

  it("accepts a complete Alibaba realtime avatar configuration", async () => {
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
      status: "CONFIGURED_NOT_ADAPTED",
      code: "ADAPTER_NOT_IMPLEMENTED"
    });
    expect(JSON.stringify(result)).not.toContain("rtc-secret-sentinel");
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
      probeTextModel: vi.fn()
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

function dependencies(
  model: ReturnType<typeof selectedModel> | null,
  options: {
    probeResult?: Record<string, unknown>;
  } = {}
) {
  return {
    findModel: vi.fn().mockResolvedValue(model),
    readConfigSecret: () => configSecret,
    probeTextModel: vi.fn().mockResolvedValue(options.probeResult ?? {
      ok: true,
      code: "LIVE_CHECK_SUCCEEDED",
      message: "真实连通测试通过。"
    })
  };
}

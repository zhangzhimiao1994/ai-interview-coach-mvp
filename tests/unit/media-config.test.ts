import { describe, expect, it, vi } from "vitest";
import { findSelectedAiModel } from "@/lib/ai/configResolver";
import {
  resolveMediaModel,
  resolveMediaModelById
} from "@/lib/media/config";
import {
  MediaConfigurationError,
  MediaProviderError
} from "@/lib/media/errors";
import type {
  BehaviorAnalysisProvider,
  CapabilityCheckResult,
  RealtimeDigitalHumanProvider,
  SpeechToTextProvider,
  TextToSpeechProvider
} from "@/lib/media/types";

vi.mock("@/lib/ai/configResolver", () => ({
  findSelectedAiModel: vi.fn(),
  findAiModelById: vi.fn()
}));

const selectedModel = {
  id: "model-1",
  providerId: "provider-1",
  displayName: "Qwen Vision",
  modelName: "qwen-vl-max-latest",
  capability: "VISION_BEHAVIOR_ANALYSIS",
  temperature: 0.25,
  maxTokens: 1800,
  timeoutMs: 45000,
  costNote: null,
  settingsJson: JSON.stringify({ minimumConfidence: 0.6 }),
  enabled: true,
  isDefault: false,
  isSelected: true,
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
  updatedAt: new Date("2026-07-16T00:00:00.000Z"),
  provider: {
    id: "provider-1",
    displayName: "Alibaba Bailian",
    providerType: "TONGYI",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyPreview: "sk-****",
    apiKeyCiphertext: "encrypted-api-key",
    apiKeyIv: "api-key-iv",
    apiKeyTag: "api-key-tag",
    credentialsCiphertext: "encrypted-credential-map",
    credentialsIv: "credential-map-iv",
    credentialsTag: "credential-map-tag",
    settingsJson: JSON.stringify({ region: "cn-beijing", workspace: "main" }),
    enabled: true
  }
};

describe("media provider contracts", () => {
  it("keeps the four adapter contracts and capability result importable", () => {
    const contracts: [
      SpeechToTextProvider?,
      TextToSpeechProvider?,
      RealtimeDigitalHumanProvider?,
      BehaviorAnalysisProvider?,
      CapabilityCheckResult?
    ] = [];

    expect(contracts).toEqual([]);
  });

  it("exposes safe typed provider errors", () => {
    const configurationError = new MediaConfigurationError(
      "No selected model is configured",
      { provider: "TONGYI", code: "MODEL_NOT_SELECTED" }
    );
    const providerError = new MediaProviderError(
      "Upstream request failed",
      "TONGYI",
      "UPSTREAM_TIMEOUT",
      true
    );

    expect(configurationError).toMatchObject({
      name: "MediaConfigurationError",
      provider: "TONGYI",
      code: "MODEL_NOT_SELECTED",
      retryable: false
    });
    expect(providerError).toMatchObject({
      name: "MediaProviderError",
      provider: "TONGYI",
      code: "UPSTREAM_TIMEOUT",
      retryable: true
    });
  });
});

describe("resolveMediaModel", () => {
  it("loads complete provider settings and credential metadata in one resolver call", async () => {
    vi.mocked(findSelectedAiModel).mockResolvedValue(selectedModel);

    const result = await resolveMediaModel("VISION_BEHAVIOR_ANALYSIS");

    expect(findSelectedAiModel).toHaveBeenCalledWith("VISION_BEHAVIOR_ANALYSIS");
    expect(result.providerSettings).toEqual({
      region: "cn-beijing",
      workspace: "main"
    });
    expect(result.credentialEnvelopes.structured).toEqual({
      ciphertext: "encrypted-credential-map",
      iv: "credential-map-iv",
      tag: "credential-map-tag"
    });
  });

  it("delegates to the current-selection resolver and returns stable parsed configuration", async () => {
    const findModel = vi.fn().mockResolvedValue(selectedModel);

    const result = await resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel);

    expect(findModel).toHaveBeenCalledOnce();
    expect(findModel).toHaveBeenCalledWith("VISION_BEHAVIOR_ANALYSIS");
    expect(result).toEqual({
      capability: "VISION_BEHAVIOR_ANALYSIS",
      providerId: "provider-1",
      providerName: "Alibaba Bailian",
      providerType: "TONGYI",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      providerSettings: { region: "cn-beijing", workspace: "main" },
      modelId: "model-1",
      modelDisplayName: "Qwen Vision",
      modelName: "qwen-vl-max-latest",
      modelSettings: { minimumConfidence: 0.6 },
      temperature: 0.25,
      maxTokens: 1800,
      timeoutMs: 45000,
      credentialEnvelopes: {
        apiKey: {
          ciphertext: "encrypted-api-key",
          iv: "api-key-iv",
          tag: "api-key-tag"
        },
        structured: {
          ciphertext: "encrypted-credential-map",
          iv: "credential-map-iv",
          tag: "credential-map-tag"
        }
      }
    });
  });

  it("throws when no enabled currently selected model exists", async () => {
    const findModel = vi.fn().mockResolvedValue(null);

    await expect(
      resolveMediaModel("TEXT_TO_SPEECH", findModel)
    ).rejects.toMatchObject({
      name: "MediaConfigurationError",
      code: "MEDIA_MODEL_NOT_SELECTED",
      retryable: false
    });
  });

  it("wraps resolver failures without leaking upstream details", async () => {
    const findModel = vi.fn().mockRejectedValue(
      new Error("database failed with encrypted-api-key")
    );

    const error = await resolveMediaModel("TEXT_TO_SPEECH", findModel)
      .catch((caught) => caught);

    expect(error).toMatchObject({
      name: "MediaConfigurationError",
      code: "MEDIA_CONFIGURATION_UNAVAILABLE",
      retryable: true
    });
    expect(error.message).not.toContain("encrypted-api-key");
  });

  it.each([
    ["a recommendation that is not selected", { isDefault: true, isSelected: false }],
    ["a disabled selected model", { enabled: false }],
    ["a model owned by a disabled provider", { provider: { ...selectedModel.provider, enabled: false } }]
  ])("rejects %s", async (_case, changes) => {
    const findModel = vi.fn().mockResolvedValue({ ...selectedModel, ...changes });

    await expect(
      resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel)
    ).rejects.toMatchObject({ code: "MEDIA_MODEL_NOT_SELECTED" });
  });

  it("rejects a selected model returned for a different capability", async () => {
    const findModel = vi.fn().mockResolvedValue({
      ...selectedModel,
      capability: "TEXT_TO_SPEECH"
    });

    await expect(
      resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel)
    ).rejects.toMatchObject({ code: "MEDIA_MODEL_NOT_SELECTED" });
  });

  it("rejects incomplete encrypted credential metadata without exposing it", async () => {
    const findModel = vi.fn().mockResolvedValue({
      ...selectedModel,
      provider: {
        ...selectedModel.provider,
        credentialsCiphertext: "structured-secret-sentinel",
        credentialsIv: null,
        credentialsTag: null
      }
    });

    const error = await resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel)
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "INVALID_CREDENTIAL_ENVELOPE" });
    expect(JSON.stringify(error)).not.toContain("structured-secret-sentinel");
  });

  it.each([
    ["malformed JSON", "{provider-secret", "provider-secret"],
    ["an array", '["provider-secret"]', "provider-secret"],
    ["null", "null", "null"]
  ])("rejects provider settings containing %s without leaking them", async (_case, settingsJson, sentinel) => {
    const findModel = vi.fn().mockResolvedValue({
      ...selectedModel,
      provider: { ...selectedModel.provider, settingsJson }
    });

    const error = await resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(MediaConfigurationError);
    expect(error).toMatchObject({ code: "INVALID_PROVIDER_SETTINGS" });
    expect(error.message).not.toContain(sentinel);
    expect(JSON.stringify(error)).not.toContain("encrypted-api-key");
    expect(JSON.stringify(error)).not.toContain("encrypted-credential-map");
  });

  it.each([
    ["malformed JSON", "{model-secret", "model-secret"],
    ["a primitive", '"model-secret"', "model-secret"]
  ])("rejects model settings containing %s without leaking them", async (_case, settingsJson, sentinel) => {
    const findModel = vi.fn().mockResolvedValue({ ...selectedModel, settingsJson });

    const error = await resolveMediaModel("VISION_BEHAVIOR_ANALYSIS", findModel)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(MediaConfigurationError);
    expect(error).toMatchObject({ code: "INVALID_MODEL_SETTINGS" });
    expect(error.message).not.toContain(sentinel);
    expect(JSON.stringify(error)).not.toContain("encrypted-api-key");
    expect(JSON.stringify(error)).not.toContain("encrypted-credential-map");
  });
});

describe("resolveMediaModelById", () => {
  it("pins an already-issued realtime ticket to its enabled model", async () => {
    const findModel = vi.fn().mockResolvedValue({
      ...selectedModel,
      isSelected: false
    });

    const result = await resolveMediaModelById(
      "model-1",
      "VISION_BEHAVIOR_ANALYSIS",
      findModel
    );

    expect(findModel).toHaveBeenCalledWith("model-1");
    expect(result.modelId).toBe("model-1");
  });

  it("rejects a ticket model that was disabled before connection", async () => {
    const findModel = vi.fn().mockResolvedValue({
      ...selectedModel,
      enabled: false
    });

    await expect(
      resolveMediaModelById(
        "model-1",
        "VISION_BEHAVIOR_ANALYSIS",
        findModel
      )
    ).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
  });
});

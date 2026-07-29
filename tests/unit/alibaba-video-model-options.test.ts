import { describe, expect, it } from "vitest";
import { modelSettingsFromForm } from "@/lib/domain/aiModelSettings";
import { modelRecommendationGroups } from "@/lib/domain/modelRecommendations";
import { parseAiModelConfigInput } from "@/lib/validators/aiServices";
import {
  encryptCredentialMap,
  encryptSecret
} from "@/lib/domain/aiServices";
import { resolveAlibabaEmoCredentials } from "@/lib/media/providers/alibabaCredentials";
import type { ResolvedMediaModel } from "@/lib/media/config";

const recommendations = modelRecommendationGroups.flatMap(
  (group) => group.recommendations
);

describe("Alibaba digital human video model options", () => {
  it("offers Lingmou broadcast and Alibaba EMO video presets", () => {
    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerType: "LINGMOU",
          capability: "DIGITAL_HUMAN_VIDEO",
          modelName: "lingmou-broadcast-video"
        }),
        expect.objectContaining({
          providerType: "TONGYI",
          capability: "DIGITAL_HUMAN_VIDEO",
          modelName: "emo-v1"
        })
      ])
    );
  });

  it("builds provider-specific video settings from the model form", () => {
    const lingmouForm = new FormData();
    lingmouForm.set("templateId", "template-1");
    lingmouForm.set("audioVariableName", "audio_url");
    lingmouForm.set("portraitVariableName", "portrait_url");
    lingmouForm.set("resolution", "1080p");
    lingmouForm.set("fps", "30");
    lingmouForm.set("watermark", "true");
    lingmouForm.set("mode", "broadcast");

    expect(
      modelSettingsFromForm(
        "DIGITAL_HUMAN_VIDEO",
        "LINGMOU",
        lingmouForm
      )
    ).toEqual({
      templateId: "template-1",
      audioVariableName: "audio_url",
      portraitVariableName: "portrait_url",
      resolution: "1080p",
      fps: 30,
      watermark: true,
      mode: "broadcast"
    });

    const emoForm = new FormData();
    emoForm.set("ratio", "3:4");

    expect(
      modelSettingsFromForm("DIGITAL_HUMAN_VIDEO", "TONGYI", emoForm)
    ).toEqual({
      model: "emo-v1",
      ratio: "3:4"
    });
  });

  it("strictly validates Alibaba video model settings", () => {
    expect(
      parseAiModelConfigInput({
        providerId: "lingmou-provider",
        displayName: "Lingmou broadcast",
        modelName: "lingmou-broadcast-video",
        capability: "DIGITAL_HUMAN_VIDEO",
        settings: {
          templateId: "template-1",
          audioVariableName: "audio_url",
          portraitVariableName: null,
          resolution: "1080p",
          fps: 30,
          watermark: false,
          mode: "broadcast"
        }
      }, "LINGMOU").settings
    ).toMatchObject({ portraitVariableName: null });

    expect(() =>
      parseAiModelConfigInput({
        providerId: "tongyi-provider",
        displayName: "Alibaba EMO",
        modelName: "emo-v1",
        capability: "DIGITAL_HUMAN_VIDEO",
        settings: { model: "emo-v1", ratio: "16:9" }
      }, "TONGYI")
    ).toThrow();
  });

  it.each([
    ["TONGYI", "emo-v1"],
    ["LINGMOU", "lingmou-broadcast-video"]
  ] as const)(
    "requires complete %s settings for its built-in video model",
    (providerType, modelName) => {
      expect(() =>
        parseAiModelConfigInput({
          providerId: `${providerType.toLowerCase()}-provider`,
          displayName: modelName,
          modelName,
          capability: "DIGITAL_HUMAN_VIDEO",
          settings: {}
        }, providerType)
      ).toThrow();
    }
  );

  it("keeps custom Alibaba video model settings compatible", () => {
    expect(
      parseAiModelConfigInput({
        providerId: "tongyi-provider",
        displayName: "Custom video model",
        modelName: "custom-video-v2",
        capability: "DIGITAL_HUMAN_VIDEO",
        settings: { mode: "custom" }
      }, "TONGYI").settings
    ).toEqual({ mode: "custom" });
  });

  it("prefers the generic DashScope key and falls back to the legacy TTS key", () => {
    const configSecret = "emo-credential-test-secret";
    const model = {
      capability: "DIGITAL_HUMAN_VIDEO",
      providerType: "TONGYI",
      credentialEnvelopes: {
        apiKey: encryptSecret("dashscope-key", configSecret),
        structured: encryptCredentialMap(
          { ttsApiKey: "legacy-tts-key" },
          configSecret
        )
      }
    } as ResolvedMediaModel;

    expect(resolveAlibabaEmoCredentials(model, () => configSecret)).toEqual({
      apiKey: "dashscope-key"
    });

    model.credentialEnvelopes.apiKey = null;
    expect(resolveAlibabaEmoCredentials(model, () => configSecret)).toEqual({
      apiKey: "legacy-tts-key"
    });
  });
});

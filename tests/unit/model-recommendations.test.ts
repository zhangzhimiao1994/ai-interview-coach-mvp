import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiCapabilities, aiProviderTypes } from "@/lib/domain/aiServiceConstants";
import { modelRecommendationGroups } from "@/lib/domain/modelRecommendations";

describe("model recommendation matrix", () => {
  it("covers the full interview product model chain", () => {
    const recommendedCapabilities = modelRecommendationGroups.flatMap((group) =>
      group.recommendations.map((recommendation) => recommendation.capability)
    );

    expect(recommendedCapabilities).toEqual(
      expect.arrayContaining([
        "INTERVIEW_DIALOGUE",
        "INTERVIEW_OUTLINE",
        "INTERVIEW_FOLLOW_UP",
        "REPORT_ANALYSIS",
        "COMPANY_RESEARCH",
        "SPEECH_TO_TEXT",
        "TEXT_TO_SPEECH",
        "DIGITAL_HUMAN_REALTIME",
        "DIGITAL_HUMAN_VIDEO",
        "VISION_BEHAVIOR_ANALYSIS",
        "EMBEDDING",
        "SAFETY_REVIEW"
      ])
    );
  });

  it("only recommends capabilities that can be selected in the admin model form", () => {
    const capabilities = new Set(aiCapabilities);

    for (const group of modelRecommendationGroups) {
      for (const recommendation of group.recommendations) {
        expect(capabilities.has(recommendation.capability)).toBe(true);
        expect(recommendation.priceNote.length).toBeGreaterThan(0);
        expect(recommendation.howToUse.length).toBeGreaterThan(0);
      }
    }
  });

  it("renders recommendations on the AI services admin page", () => {
    const source = readFileSync(join(process.cwd(), "components/admin/AiServiceConfigPanel.tsx"), "utf8");

    expect(source).toContain("模型推荐矩阵");
    expect(source).toContain("modelRecommendationGroups");
    expect(source).toContain("添加参考");
  });

  it("uses Qwen-Audio-TTS as the default Bailian speech synthesis recommendation", () => {
    const recommendations = modelRecommendationGroups.flatMap((group) => group.recommendations);

    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "SPEECH_TO_TEXT",
        providerType: "TONGYI",
        modelName: "qwen3-asr-flash-realtime"
      }),
      expect.objectContaining({
        capability: "TEXT_TO_SPEECH",
        providerType: "TONGYI",
        modelName: "qwen-audio-3.0-tts-flash",
        fit: expect.stringContaining("Qwen-Audio-TTS")
      }),
      expect.objectContaining({
        capability: "TEXT_TO_SPEECH",
        providerType: "TONGYI",
        modelName: "cosyvoice-v3-flash",
        fit: expect.stringContaining("备选")
      }),
      expect.objectContaining({
        capability: "DIGITAL_HUMAN_REALTIME",
        providerType: "LINGMOU",
        modelName: "lingmou-2d-cloud-audio-driven"
      }),
      expect.objectContaining({
        capability: "INTERVIEW_FOLLOW_UP",
        providerType: "TONGYI",
        modelName: "qwen3.5-omni-plus",
        fit: expect.stringContaining("全模态接管")
      }),
      expect.objectContaining({
        capability: "VISION_BEHAVIOR_ANALYSIS",
        providerType: "TONGYI",
        modelName: "qwen3.6-flash"
      }),
      expect.objectContaining({
        capability: "VISION_BEHAVIOR_ANALYSIS",
        providerType: "TONGYI",
        modelName: "qwen3.5-omni-plus",
        fit: expect.stringContaining("全模态调试")
      })
    ]));
  });

  it("exposes separate Bailian, Lingmou, and runtime-aligned capability settings", () => {
    const source = [
      "components/admin/AiServiceConfigPanel.tsx",
      "components/admin/AiMultimodalConfigFields.tsx",
      "lib/domain/aiModelSettings.ts",
      "lib/domain/modelRecommendations.ts"
    ].map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");

    for (const field of [
      "workspaceId",
      "asrApiKey",
      "ttsApiKey",
      "accessKeyId",
      "accessKeySecret",
      "sampleRate",
      "format",
      "channels",
      "instruction",
      "configId",
      "instanceId",
      "renderMode",
      "integrationMode",
      "client",
      "minimumConfidence",
      "frameIntervalMs"
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("credentials:");
    expect(source).toContain("settings:");
    expect(source).toContain("qwen-audio-3.0-tts-flash");
    expect(source).toContain("modelPreset");
    expect(source).toContain("settings={modelDraft.settings}");
    expect(source).toContain("stringSetting(settings");
    expect(source).toContain("自定义");
    expect(aiProviderTypes).toContain("LINGMOU");
  });
});

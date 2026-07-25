import { describe, expect, it } from "vitest";
import {
  defaultMultimodalTakeoverCapabilities,
  isSupportedMultimodalTakeoverModel,
  parseMultimodalTakeoverSettings,
  selectModelWithMultimodalTakeover
} from "@/lib/domain/multimodalTakeover";

type RuntimeModel = {
  id: string;
  capability: string;
  modelName: string;
  enabled: boolean;
  provider: { enabled: boolean };
};

const omniModel: RuntimeModel = {
  id: "model-omni",
  capability: "INTERVIEW_FOLLOW_UP",
  modelName: "qwen3.5-omni-plus",
  enabled: true,
  provider: { enabled: true }
};

describe("multimodal takeover rules", () => {
  it("defaults to covering the interactive abilities that the current app can route through an Omni model", () => {
    expect(defaultMultimodalTakeoverCapabilities).toEqual([
      "INTERVIEW_FOLLOW_UP",
      "VISION_BEHAVIOR_ANALYSIS"
    ]);
  });

  it("keeps explicit single-capability model selection ahead of the takeover model", () => {
    const directModel: RuntimeModel = {
      id: "model-follow-up",
      capability: "INTERVIEW_FOLLOW_UP",
      modelName: "qwen-plus",
      enabled: true,
      provider: { enabled: true }
    };

    const selected = selectModelWithMultimodalTakeover({
      capability: "INTERVIEW_FOLLOW_UP",
      directModel,
      takeoverModel: omniModel,
      settings: {
        enabled: true,
        modelId: "model-omni",
        coveredCapabilities: ["INTERVIEW_FOLLOW_UP"]
      }
    });

    expect(selected).toBe(directModel);
  });

  it("uses the enabled Omni model when a covered capability has no single model configured", () => {
    const selected = selectModelWithMultimodalTakeover({
      capability: "VISION_BEHAVIOR_ANALYSIS",
      directModel: null,
      takeoverModel: omniModel,
      settings: {
        enabled: true,
        modelId: "model-omni",
        coveredCapabilities: ["VISION_BEHAVIOR_ANALYSIS"]
      }
    });

    expect(selected).toBe(omniModel);
  });

  it("rejects disabled, unsupported, or uncovered takeover candidates", () => {
    expect(
      selectModelWithMultimodalTakeover({
        capability: "TEXT_TO_SPEECH",
        directModel: null,
        takeoverModel: omniModel,
        settings: {
          enabled: true,
          modelId: "model-omni",
          coveredCapabilities: ["VISION_BEHAVIOR_ANALYSIS"]
        }
      })
    ).toBeNull();

    expect(
      selectModelWithMultimodalTakeover({
        capability: "VISION_BEHAVIOR_ANALYSIS",
        directModel: null,
        takeoverModel: {
          ...omniModel,
          modelName: "qwen-plus"
        },
        settings: {
          enabled: true,
          modelId: "model-omni",
          coveredCapabilities: ["VISION_BEHAVIOR_ANALYSIS"]
        }
      })
    ).toBeNull();
  });

  it("parses persisted settings safely and filters unsupported capability names", () => {
    expect(
      parseMultimodalTakeoverSettings(
        JSON.stringify({
          enabled: true,
          modelId: "model-omni",
          coveredCapabilities: [
            "INTERVIEW_FOLLOW_UP",
            "TEXT_TO_SPEECH",
            "NOT_A_CAPABILITY"
          ]
        })
      )
    ).toEqual({
      enabled: true,
      modelId: "model-omni",
      coveredCapabilities: ["INTERVIEW_FOLLOW_UP", "TEXT_TO_SPEECH"]
    });
  });

  it("recognizes official and user-requested Qwen Omni model names", () => {
    expect(isSupportedMultimodalTakeoverModel("qwen3.5-omni-plus")).toBe(true);
    expect(isSupportedMultimodalTakeoverModel("qwen3.5-omni-plus-realtime")).toBe(true);
    expect(isSupportedMultimodalTakeoverModel("qwen3-omni-plus")).toBe(true);
    expect(isSupportedMultimodalTakeoverModel("qwen-plus")).toBe(false);
  });
});

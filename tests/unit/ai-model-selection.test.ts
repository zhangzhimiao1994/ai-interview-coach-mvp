import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, findUnique, runtimeFindUnique } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  runtimeFindUnique: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    aiModelConfig: { findFirst, findUnique },
    aiRuntimeSetting: { findUnique: runtimeFindUnique }
  }
}));

import {
  findAiModelById,
  findSelectedAiModel
} from "@/lib/ai/configResolver";

describe("AI model runtime selection", () => {
  beforeEach(() => {
    findFirst.mockReset();
    findUnique.mockReset();
    runtimeFindUnique.mockReset();
    runtimeFindUnique.mockResolvedValue(null);
  });

  it("routes by the currently selected model instead of the recommended default", async () => {
    findFirst.mockResolvedValue(null);

    await findSelectedAiModel("REPORT_ANALYSIS");

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        capability: "REPORT_ANALYSIS",
        enabled: true,
        isSelected: true
      })
    }));
    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty("isDefault");
    expect(findFirst.mock.calls[0][0].include.provider.select).toEqual(
      expect.objectContaining({
        settingsJson: true,
        credentialsCiphertext: true,
        credentialsIv: true,
        credentialsTag: true
      })
    );
  });

  it("loads a pinned realtime model by ID without re-routing to a recommendation", async () => {
    findUnique.mockResolvedValue(null);

    await findAiModelById("model-asr");

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "model-asr" } })
    );
    expect(findUnique.mock.calls[0][0].include.provider.select).toEqual(
      expect.objectContaining({
        settingsJson: true,
        credentialsCiphertext: true
      })
    );
  });

  it("falls back to the configured Omni takeover model for covered capabilities without a selected single model", async () => {
    const takeoverModel = {
      id: "model-omni",
      capability: "INTERVIEW_FOLLOW_UP",
      modelName: "qwen3.5-omni-plus",
      enabled: true,
      isSelected: true,
      provider: { enabled: true, providerType: "TONGYI" }
    };
    findFirst.mockResolvedValue(null);
    runtimeFindUnique.mockResolvedValue({
      valueJson: JSON.stringify({
        enabled: true,
        modelId: "model-omni",
        coveredCapabilities: ["VISION_BEHAVIOR_ANALYSIS"]
      })
    });
    findUnique.mockResolvedValue(takeoverModel);

    const result = await findSelectedAiModel("VISION_BEHAVIOR_ANALYSIS");

    expect(result).toBe(takeoverModel);
    expect(runtimeFindUnique).toHaveBeenCalledWith({
      where: { key: "ai.multimodalTakeover" }
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "model-omni" }
      })
    );
  });
});

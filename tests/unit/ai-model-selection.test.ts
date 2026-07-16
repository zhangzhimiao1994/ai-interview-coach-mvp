import { describe, expect, it, vi } from "vitest";

const { findFirst, findUnique } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    aiModelConfig: { findFirst, findUnique }
  }
}));

import {
  findAiModelById,
  findSelectedAiModel
} from "@/lib/ai/configResolver";

describe("AI model runtime selection", () => {
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
});

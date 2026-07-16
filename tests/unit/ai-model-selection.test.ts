import { describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    aiModelConfig: { findFirst }
  }
}));

import { findSelectedAiModel } from "@/lib/ai/configResolver";

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
  });
});

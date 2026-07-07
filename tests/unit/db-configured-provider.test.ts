import { describe, expect, it, vi } from "vitest";
import { createDbConfiguredAiProvider } from "@/lib/ai/dbConfiguredProvider";

describe("DB configured AI provider", () => {
  it("falls back to mock when no enabled model config exists", async () => {
    const provider = createDbConfiguredAiProvider({
      findModel: vi.fn().mockResolvedValue(null)
    });

    const outline = await provider.generateTrainingOutline({
      targetRole: "Product Manager",
      stages: ["FORMAL_INTERVIEW"],
      questionCountPerStage: 1
    });

    expect(outline.questions).toHaveLength(1);
    expect(outline.questions[0].stage).toBe("FORMAL_INTERVIEW");
  });
});

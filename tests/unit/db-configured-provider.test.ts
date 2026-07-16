import { describe, expect, it, vi } from "vitest";
import { createDbConfiguredAiProvider } from "@/lib/ai/dbConfiguredProvider";
import type { AiProvider } from "@/lib/ai/types";

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

  it("does not hide a selected provider initialization failure with mock output", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_CONFIG_SECRET", "");
    const fallbackProvider: AiProvider = {
      generateTrainingOutline: vi.fn().mockResolvedValue({
        title: "Fallback outline",
        targetRole: "Product Manager",
        stages: ["FORMAL_INTERVIEW"],
        estimatedMinutes: 2,
        questions: []
      }),
      generateFollowUpCoaching: vi.fn(),
      generateCoachingReport: vi.fn()
    };
    const provider = createDbConfiguredAiProvider({
      fallbackProvider,
      findModel: vi.fn().mockResolvedValue({
        id: "model-1",
        providerId: "provider-1",
        displayName: "Broken model",
        modelName: "deepseek-chat",
        capability: "INTERVIEW_OUTLINE",
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 30000,
        costNote: null,
        enabled: true,
        isDefault: true,
        isSelected: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: {
          id: "provider-1",
          displayName: "DeepSeek",
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyPreview: "sk-d****abcd",
          apiKeyCiphertext: "cipher",
          apiKeyIv: "iv",
          apiKeyTag: "tag",
          enabled: true
        }
      })
    });

    await expect(
      provider.generateTrainingOutline({
        targetRole: "Product Manager",
        stages: ["FORMAL_INTERVIEW"]
      })
    ).rejects.toThrow(/AI_CONFIG_SECRET/);
    expect(fallbackProvider.generateTrainingOutline).not.toHaveBeenCalled();
  });
});

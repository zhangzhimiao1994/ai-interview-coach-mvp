import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/domain/aiServices";
import { createDbConfiguredAiProvider } from "@/lib/ai/dbConfiguredProvider";
import type { AiProvider } from "@/lib/ai/types";

describe("DB configured AI provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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

  it("disables DeepSeek V4 thinking mode for structured interview output", async () => {
    const configSecret = "deepseek-structured-output-test-secret";
    const encrypted = encryptSecret("sk-deepseek-test", configSecret);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "PM interview",
              targetRole: "Product Manager",
              stages: ["FORMAL_INTERVIEW"],
              estimatedMinutes: 2,
              questions: [{
                id: "formal-0",
                stage: "FORMAL_INTERVIEW",
                prompt: "Introduce one project.",
                expectedFocus: ["impact"],
                followUps: ["What changed?"],
                difficulty: "MEDIUM",
                timeLimitSeconds: 120
              }]
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("AI_CONFIG_SECRET", configSecret);
    const provider = createDbConfiguredAiProvider({
      findModel: vi.fn().mockResolvedValue({
        id: "model-deepseek-v4",
        providerId: "provider-deepseek",
        displayName: "DeepSeek V4 Pro",
        modelName: "deepseek-v4-pro",
        capability: "INTERVIEW_OUTLINE",
        temperature: 0.4,
        maxTokens: 2400,
        timeoutMs: 60000,
        costNote: null,
        enabled: true,
        isDefault: false,
        isSelected: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: {
          id: "provider-deepseek",
          displayName: "DeepSeek",
          providerType: "DEEPSEEK",
          baseUrl: "https://api.deepseek.com",
          apiKeyPreview: "sk-d****test",
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyTag: encrypted.tag,
          credentialsCiphertext: null,
          credentialsIv: null,
          credentialsTag: null,
          settingsJson: "{}",
          enabled: true
        }
      })
    });

    await provider.generateTrainingOutline({
      targetRole: "Product Manager",
      stages: ["FORMAL_INTERVIEW"]
    });

    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(requestBody.thinking).toEqual({ type: "disabled" });
  });
});

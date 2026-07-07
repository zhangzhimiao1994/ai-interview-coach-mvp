import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";

describe("OpenAI-compatible provider", () => {
  it("calls chat completions and parses a training outline JSON response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "PM interview",
                  targetRole: "Product Manager",
                  targetCompany: "Example Tech",
                  stages: ["FORMAL_INTERVIEW"],
                  estimatedMinutes: 2,
                  questions: [
                    {
                      id: "formal-0",
                      stage: "FORMAL_INTERVIEW",
                      prompt: "Tell me about a product project you shipped.",
                      expectedFocus: ["context", "personal contribution"],
                      followUps: ["How did you measure the result?"],
                      difficulty: "MEDIUM",
                      timeLimitSeconds: 120
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      temperature: 0.2,
      maxTokens: 1600,
      timeoutMs: 30000,
      fetchImpl
    });

    const outline = await provider.generateTrainingOutline({
      targetRole: "Product Manager",
      targetCompany: "Example Tech",
      stages: ["FORMAL_INTERVIEW"],
      questionCountPerStage: 1,
      preferredLanguage: "zh-CN"
    });

    expect(outline.questions[0].prompt).toContain("product project");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json"
        })
      })
    );
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(requestBody.model).toBe("deepseek-chat");
    expect(requestBody.temperature).toBe(0.2);
    expect(requestBody.max_tokens).toBe(1600);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("calls chat completions and parses a coaching report JSON response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  overallScore: 82,
                  subScores: {
                    expressionStructure: 80,
                    contentRelevance: 84,
                    confidence: 78,
                    pressureHandling: 76,
                    roleFit: 86
                  },
                  perQuestionFeedback: [
                    {
                      questionId: "formal-0",
                      stage: "FORMAL_INTERVIEW",
                      score: 82,
                      strengths: ["clear structure"],
                      improvements: ["add measurable outcomes"]
                    }
                  ],
                  expressionAnalysis: {
                    summary: "The answer was complete.",
                    strongPoints: ["clear opening"],
                    improvementPoints: ["stronger closing"]
                  },
                  answerQualityAnalysis: {
                    summary: "The answer was relevant.",
                    evidence: ["mentioned project context"],
                    gaps: ["missing metrics"]
                  },
                  strategySuggestions: ["Lead with the conclusion."],
                  weakTags: ["metrics"],
                  nextTrainingPlan: {
                    focus: "Add outcome metrics",
                    drills: ["Rewrite with STAR"],
                    recommendedStages: ["FORMAL_INTERVIEW"]
                  },
                  candidateSummary: "Solid foundation."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      temperature: 0.2,
      maxTokens: 1600,
      timeoutMs: 30000,
      fetchImpl
    });

    const report = await provider.generateCoachingReport({
      targetRole: "Product Manager",
      turns: [
        {
          stage: "FORMAL_INTERVIEW",
          question: "Introduce one project.",
          answer: "I led a growth project."
        }
      ]
    });

    expect(report.overallScore).toBe(82);
    expect(report.strategySuggestions).toContain("Lead with the conclusion.");
  });
});

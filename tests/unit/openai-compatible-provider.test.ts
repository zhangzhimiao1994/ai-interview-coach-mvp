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
                      improvements: ["add measurable outcomes"],
                      answerEvidence: ["I led a growth project"],
                      improvementAction: "Add baseline and uplift metrics."
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
                  candidateSummary: "Solid foundation.",
                  details: {
                    readinessVerdict: {
                      level: "READY_WITH_RISKS",
                      summary: "Ready with evidence risk.",
                      priorityRisk: "Missing measurable outcomes."
                    },
                    scoreExplanations: {
                      expressionStructure: "Clear opening.",
                      contentRelevance: "Relevant PM project.",
                      confidence: "Stable.",
                      pressureHandling: "Needs data defense.",
                      roleFit: "Good PM fit."
                    },
                    competencyAssessment: [
                      {
                        competency: "Evidence quality",
                        evidence: "Mentioned a growth project.",
                        risk: "No metric.",
                        coachingAction: "Add the metric."
                      }
                    ],
                    priorityActions: [
                      {
                        title: "Quantify one project",
                        reason: "The answer lacks measurable impact.",
                        drill: "Rewrite with baseline and result."
                      }
                    ],
                    weeklyPlan: [
                      {
                        day: 1,
                        stage: "FORMAL_INTERVIEW",
                        drill: "Rewrite one STAR answer.",
                        successCriterion: "Contains one metric."
                      }
                    ]
                  }
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
    expect(report.perQuestionFeedback[0].answerEvidence).toContain("I led a growth project");
    expect(report.details?.readinessVerdict.priorityRisk).toBe("Missing measurable outcomes.");
  });

  it("extracts JSON from a Markdown code block", async () => {
    const content = `\`\`\`json\n${JSON.stringify(validOutline())}\n\`\`\``;
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(content));
    const provider = outlineProvider(fetchImpl);

    const outline = await provider.generateTrainingOutline(outlineRequest);

    expect(outline.title).toBe("PM interview");
  });

  it("retries transient upstream failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(validOutline())));
    const provider = outlineProvider(fetchImpl, { retryBaseDelayMs: 0 });

    await expect(provider.generateTrainingOutline(outlineRequest)).resolves.toMatchObject({
      title: "PM interview"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries without JSON mode when an endpoint does not support response_format", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("response_format is not supported", { status: 400 }))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(validOutline())));
    const provider = outlineProvider(fetchImpl, { retryBaseDelayMs: 0 });

    await provider.generateTrainingOutline(outlineRequest);

    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody.response_format).toBeUndefined();
  });

  it("reports an upstream structured-output error when the JSON shape is invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse("{}"));
    const provider = outlineProvider(fetchImpl);

    await expect(provider.generateTrainingOutline(outlineRequest)).rejects.toThrow(
      /required structure/
    );
  });
});

const outlineRequest = {
  targetRole: "Product Manager",
  targetCompany: "Example Tech",
  stages: ["FORMAL_INTERVIEW" as const],
  questionCountPerStage: 1,
  preferredLanguage: "zh-CN" as const
};

function validOutline() {
  return {
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
  };
}

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function outlineProvider(
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides: { retryBaseDelayMs?: number } = {}
) {
  return createOpenAiCompatibleProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    modelName: "deepseek-chat",
    temperature: 0.2,
    maxTokens: 1600,
    timeoutMs: 30000,
    fetchImpl,
    ...overrides
  });
}

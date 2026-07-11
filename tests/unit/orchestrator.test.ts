import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuestionId,
  createAiOrchestrator,
  createConfiguredAiOrchestrator,
  deserializeStoredCoachingReport,
  mockAiProvider,
  serializeCoachingReportForStorage
} from "@/lib/ai";
import type { AiProvider, CoachingReportResult, TrainingOutline } from "@/lib/ai";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createAiOrchestrator", () => {
  it("delegates training outline generation to the configured provider with exact input", async () => {
    const providerResult: TrainingOutline = {
      title: "Provider result",
      targetRole: "Product Manager",
      stages: ["WARM_UP"],
      estimatedMinutes: 2,
      questions: []
    };
    const provider: AiProvider = {
      generateTrainingOutline: vi.fn().mockResolvedValue(providerResult),
      generateFollowUpCoaching: vi.fn(),
      generateCoachingReport: vi.fn()
    };
    const request = {
      targetRole: "Product Manager",
      targetCompany: "Acme",
      stages: ["WARM_UP"] as const
    };

    const orchestrator = createAiOrchestrator({ provider });
    const outline = await orchestrator.generateTrainingOutline(request);

    expect(provider.generateTrainingOutline).toHaveBeenCalledTimes(1);
    expect(provider.generateTrainingOutline).toHaveBeenCalledWith(request);
    expect(outline).toBe(providerResult);
  });

  it("delegates live follow-up coaching to the configured provider", async () => {
    const providerResult = {
      instantFeedback: "先给结论，再补充例子。",
      followUpQuestion: "这个结果如何量化？",
      suggestedAnswerStructure: ["结论", "行动", "结果"],
      riskTags: ["量化不足"]
    };
    const provider: AiProvider = {
      generateTrainingOutline: vi.fn(),
      generateFollowUpCoaching: vi.fn().mockResolvedValue(providerResult),
      generateCoachingReport: vi.fn()
    };
    const input = {
      sessionId: "session-1",
      currentTurn: {
        stage: "WARM_UP" as const,
        question: "Introduce yourself.",
        answer: "I build growth products."
      }
    };

    const orchestrator = createAiOrchestrator({ provider });
    const coaching = await orchestrator.generateFollowUpCoaching(input);

    expect(provider.generateFollowUpCoaching).toHaveBeenCalledTimes(1);
    expect(provider.generateFollowUpCoaching).toHaveBeenCalledWith(input);
    expect(coaching).toBe(providerResult);
  });

  it("delegates coaching report generation to the configured provider with exact input", async () => {
    const providerResult: CoachingReportResult = {
      overallScore: 91,
      subScores: {
        expressionStructure: 90,
        contentRelevance: 91,
        confidence: 92,
        pressureHandling: 89,
        roleFit: 93
      },
      perQuestionFeedback: [],
      expressionAnalysis: {
        summary: "Clear and concise.",
        strongPoints: ["Structured opening"],
        improvementPoints: ["Add one metric"]
      },
      answerQualityAnalysis: {
        summary: "Relevant answer.",
        evidence: ["Named a concrete project"],
        gaps: ["Impact could be sharper"]
      },
      strategySuggestions: ["Lead with the outcome."],
      weakTags: ["metrics"],
      nextTrainingPlan: {
        focus: "Quantified outcomes",
        drills: ["Rewrite two project stories"],
        recommendedStages: ["FORMAL_INTERVIEW"]
      },
      candidateSummary: "Ready for the next round."
    };
    const provider: AiProvider = {
      generateTrainingOutline: vi.fn(),
      generateFollowUpCoaching: vi.fn(),
      generateCoachingReport: vi.fn().mockResolvedValue(providerResult)
    };
    const input = {
      sessionId: "session-1",
      targetRole: "Product Manager",
      turns: [
        {
          stage: "WARM_UP" as const,
          question: "Introduce yourself.",
          answer: "I build growth products."
        }
      ]
    };

    const orchestrator = createAiOrchestrator({ provider });
    const report = await orchestrator.generateCoachingReport(input);

    expect(provider.generateCoachingReport).toHaveBeenCalledTimes(1);
    expect(provider.generateCoachingReport).toHaveBeenCalledWith(input);
    expect(report).toBe(providerResult);
  });
});

describe("mockAiProvider", () => {
  it("generates a training outline", async () => {
    const outline = await mockAiProvider.generateTrainingOutline({
      targetRole: "Product Manager",
      targetCompany: "Acme",
      stages: ["WARM_UP", "FORMAL_INTERVIEW", "PRESSURE_FOLLOW_UP"]
    });

    expect(outline.questions.length).toBeGreaterThan(0);
    expect(outline.questions[0].stage).toBe("WARM_UP");
  });

  it("uses outline-aligned per-stage fallback question IDs when report turns have no question IDs", async () => {
    const report = await mockAiProvider.generateCoachingReport({
      sessionId: "session-1",
      targetRole: "Product Manager",
      turns: [
        {
          stage: "FORMAL_INTERVIEW",
          question: "Why are you a fit?",
          answer: "I have shipped similar product launches."
        },
        {
          stage: "WARM_UP",
          question: "Introduce yourself.",
          answer: "I have three years of product experience."
        },
        {
          stage: "FORMAL_INTERVIEW",
          question: "What result are you proud of?",
          answer: "I improved retention through onboarding changes."
        }
      ]
    });

    expect(report.overallScore).toBeGreaterThanOrEqual(60);
    expect(report.perQuestionFeedback.map((feedback) => feedback.questionId)).toEqual([
      "formal-interview-1",
      "warm-up-1",
      "formal-interview-2"
    ]);
  });

  it("preserves provided question IDs when generating report feedback", async () => {
    const report = await mockAiProvider.generateCoachingReport({
      sessionId: "session-1",
      targetRole: "Product Manager",
      turns: [
        {
          questionId: "custom-question-id",
          stage: "FORMAL_INTERVIEW",
          question: "Why are you a fit?",
          answer: "I have shipped similar product launches."
        }
      ]
    });

    expect(report.perQuestionFeedback[0].questionId).toBe("custom-question-id");
  });
});

describe("buildQuestionId", () => {
  it("builds lower-kebab per-stage question IDs", () => {
    expect(buildQuestionId("FORMAL_INTERVIEW", 0)).toBe("formal-interview-1");
    expect(buildQuestionId("PRESSURE_FOLLOW_UP", 2)).toBe("pressure-follow-up-3");
  });
});

describe("serializeCoachingReportForStorage", () => {
  it("maps structured coaching report fields to Prisma string columns", () => {
    const report: CoachingReportResult = {
      overallScore: 88,
      subScores: {
        expressionStructure: 80,
        contentRelevance: 90,
        confidence: 85,
        pressureHandling: 82,
        roleFit: 91
      },
      perQuestionFeedback: [
        {
          questionId: "WARM_UP-1",
          stage: "WARM_UP",
          score: 84,
          strengths: ["Clear motivation"],
          improvements: ["Add role-specific detail"]
        }
      ],
      expressionAnalysis: {
        summary: "Well structured.",
        strongPoints: ["Good pacing"],
        improvementPoints: ["Sharper conclusion"]
      },
      answerQualityAnalysis: {
        summary: "Relevant examples.",
        evidence: ["Used project context"],
        gaps: ["Missing metric"]
      },
      strategySuggestions: ["Use STAR."],
      weakTags: ["metrics"],
      nextTrainingPlan: {
        focus: "Evidence-led answers",
        drills: ["Add metrics to three answers"],
        recommendedStages: ["FORMAL_INTERVIEW"]
      },
      candidateSummary: "Solid baseline readiness."
    };

    expect(serializeCoachingReportForStorage(report)).toEqual({
      overallScore: 88,
      subScores: JSON.stringify(report.subScores),
      perQuestionFeedback: JSON.stringify(report.perQuestionFeedback),
      expressionAnalysis: JSON.stringify(report.expressionAnalysis),
      answerQualityAnalysis: JSON.stringify(report.answerQualityAnalysis),
      strategySuggestions: JSON.stringify(report.strategySuggestions),
      weakTags: JSON.stringify(report.weakTags),
      nextTrainingPlan: JSON.stringify(report.nextTrainingPlan),
      candidateSummary: "Solid baseline readiness."
    });
  });
});

describe("deserializeStoredCoachingReport", () => {
  it("maps stored Prisma report records back to structured coaching report results", () => {
    const report: CoachingReportResult = {
      overallScore: 88,
      subScores: {
        expressionStructure: 80,
        contentRelevance: 90,
        confidence: 85,
        pressureHandling: 82,
        roleFit: 91
      },
      perQuestionFeedback: [
        {
          questionId: "warm-up-1",
          stage: "WARM_UP",
          score: 84,
          strengths: ["Clear motivation"],
          improvements: ["Add role-specific detail"]
        }
      ],
      expressionAnalysis: {
        summary: "Well structured.",
        strongPoints: ["Good pacing"],
        improvementPoints: ["Sharper conclusion"]
      },
      answerQualityAnalysis: {
        summary: "Relevant examples.",
        evidence: ["Used project context"],
        gaps: ["Missing metric"]
      },
      strategySuggestions: ["Use STAR."],
      weakTags: ["metrics"],
      nextTrainingPlan: {
        focus: "Evidence-led answers",
        drills: ["Add metrics to three answers"],
        recommendedStages: ["FORMAL_INTERVIEW"]
      },
      candidateSummary: "Solid baseline readiness."
    };
    const storedReport = {
      id: "report-1",
      sessionId: "session-1",
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      ...serializeCoachingReportForStorage(report)
    };

    expect(deserializeStoredCoachingReport(storedReport)).toEqual(report);
  });
});

describe("createConfiguredAiOrchestrator", () => {
  it("defaults to the database provider with mock fallback", async () => {
    vi.stubEnv("AI_PROVIDER", "");

    const orchestrator = createConfiguredAiOrchestrator();
    const outline = await orchestrator.generateTrainingOutline({
      targetRole: "Designer",
      stages: ["WARM_UP"]
    });

    expect(outline.title).toBe("Designer mock interview outline");
  });

  it("supports AI_PROVIDER=mock", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");

    const orchestrator = createConfiguredAiOrchestrator();
    const outline = await orchestrator.generateTrainingOutline({
      targetRole: "Designer",
      stages: ["WARM_UP"]
    });

    expect(outline.questions[0].stage).toBe("WARM_UP");
  });

  it("throws a clear error for unsupported AI_PROVIDER values", () => {
    vi.stubEnv("AI_PROVIDER", "openai");

    expect(() => createConfiguredAiOrchestrator()).toThrow(
      'Unsupported AI_PROVIDER "openai". Supported values: database, mock.'
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuestionId,
  createAiOrchestrator,
  createConfiguredAiOrchestrator,
  deserializeStoredCoachingReport,
  mockAiProvider,
  serializeCoachingReportForStorage
} from "@/lib/ai";
import type {
  AiProvider,
  CoachingReportResult,
  TrainingOutline,
  TrainingOutlineRequest
} from "@/lib/ai";

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
    const request: TrainingOutlineRequest = {
      targetRole: "Product Manager",
      targetCompany: "Acme",
      stages: ["WARM_UP"]
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
          improvements: ["Add role-specific detail"],
          answerEvidence: ["I led the onboarding experiment"],
          improvementAction: "Add the retention lift and your exact decision."
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
      candidateSummary: "Solid baseline readiness.",
      details: {
        readinessVerdict: {
          level: "NEEDS_PRACTICE",
          summary: "Can enter a real interview after targeted evidence drills.",
          priorityRisk: "Evidence is still too general for pressure follow-ups."
        },
        scoreExplanations: {
          expressionStructure: "Opening is clear, but the answer does not close with a decision.",
          contentRelevance: "Project content is relevant to the PM role.",
          confidence: "Tone is stable.",
          pressureHandling: "Needs stronger data defense under challenge.",
          roleFit: "Examples map to product discovery and launch ownership."
        },
        competencyAssessment: [
          {
            competency: "Structured communication",
            evidence: "Used a product launch example with a clear role.",
            risk: "Conclusion is buried after context.",
            coachingAction: "Lead every answer with conclusion, then STAR evidence."
          }
        ],
        priorityActions: [
          {
            title: "Quantify the strongest project story",
            reason: "The answer has context but lacks measurable impact.",
            drill: "Rewrite it with baseline, action, result, and lesson."
          }
        ],
        weeklyPlan: [
          {
            day: 1,
            stage: "FORMAL_INTERVIEW",
            drill: "Rewrite one project answer with metrics.",
            successCriterion: "Answer includes baseline, result, and candidate contribution."
          }
        ]
      }
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
      candidateSummary: "Solid baseline readiness.",
      detailsJson: JSON.stringify(report.details)
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
          improvements: ["Add role-specific detail"],
          answerEvidence: ["I led the onboarding experiment"],
          improvementAction: "Add the retention lift and your exact decision."
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
      candidateSummary: "Solid baseline readiness.",
      details: {
        readinessVerdict: {
          level: "READY_WITH_RISKS",
          summary: "Candidate can attempt the interview but should tighten evidence first.",
          priorityRisk: "Pressure follow-up may expose vague metrics."
        },
        scoreExplanations: {
          expressionStructure: "Answer is organized enough to follow.",
          contentRelevance: "Relevant project example.",
          confidence: "Stable delivery.",
          pressureHandling: "Needs a better challenge response.",
          roleFit: "Good match to PM execution work."
        },
        competencyAssessment: [
          {
            competency: "Evidence quality",
            evidence: "Mentioned project context.",
            risk: "No baseline or measurable result.",
            coachingAction: "Add numbers and trade-off decisions."
          }
        ],
        priorityActions: [
          {
            title: "Strengthen evidence",
            reason: "Current evidence is too broad.",
            drill: "Add one metric to each answer."
          }
        ],
        weeklyPlan: [
          {
            day: 1,
            stage: "FORMAL_INTERVIEW",
            drill: "Practice one STAR answer.",
            successCriterion: "Answer has a measurable result."
          }
        ]
      }
    };
    const storedReport = {
      id: "report-1",
      sessionId: "session-1",
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      ...serializeCoachingReportForStorage(report)
    };

    expect(deserializeStoredCoachingReport(storedReport)).toEqual(report);
  });

  it("keeps older stored reports readable when detailsJson is missing", () => {
    const report: CoachingReportResult = {
      overallScore: 70,
      subScores: {
        expressionStructure: 70,
        contentRelevance: 70,
        confidence: 70,
        pressureHandling: 70,
        roleFit: 70
      },
      perQuestionFeedback: [],
      expressionAnalysis: {
        summary: "Basic structure.",
        strongPoints: [],
        improvementPoints: []
      },
      answerQualityAnalysis: {
        summary: "Basic answer.",
        evidence: [],
        gaps: []
      },
      strategySuggestions: [],
      weakTags: [],
      nextTrainingPlan: {
        focus: "Practice",
        drills: [],
        recommendedStages: ["FORMAL_INTERVIEW"]
      },
      candidateSummary: "Legacy report."
    };
    const storedReport = {
      ...serializeCoachingReportForStorage(report)
    };

    const result = deserializeStoredCoachingReport({
      ...storedReport,
      detailsJson: undefined
    });

    expect(result.details).toBeUndefined();
    expect(result.candidateSummary).toBe("Legacy report.");
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

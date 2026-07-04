import { describe, expect, it, vi } from "vitest";
import type { CoachingReportResult, TrainingOutline } from "@/lib/ai";

const validStageConfig = JSON.stringify([
  { type: "WARM_UP", enabled: true, durationMinutes: 5, visibleTransition: true },
  { type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 15, visibleTransition: true },
  { type: "AI_REVIEW", enabled: true, durationMinutes: 3, visibleTransition: true }
]);

const outline: TrainingOutline = {
  title: "Product Manager mock interview outline",
  targetRole: "Product Manager",
  targetCompany: "Acme",
  stages: ["WARM_UP", "FORMAL_INTERVIEW", "AI_REVIEW"],
  estimatedMinutes: 6,
  questions: [
    {
      id: "warm-up-1",
      stage: "WARM_UP",
      prompt: "Introduce yourself.",
      expectedFocus: ["background"],
      followUps: [],
      difficulty: "LOW",
      timeLimitSeconds: 60
    }
  ]
};

const report: CoachingReportResult = {
  overallScore: 82,
  subScores: {
    expressionStructure: 80,
    contentRelevance: 84,
    confidence: 81,
    pressureHandling: 78,
    roleFit: 85
  },
  perQuestionFeedback: [
    {
      questionId: "warm-up-1",
      stage: "WARM_UP",
      score: 82,
      strengths: ["Clear"],
      improvements: ["Add metrics"]
    }
  ],
  expressionAnalysis: {
    summary: "Clear structure.",
    strongPoints: ["Concise"],
    improvementPoints: ["More specifics"]
  },
  answerQualityAnalysis: {
    summary: "Relevant answer.",
    evidence: ["Named role fit"],
    gaps: ["Missing metric"]
  },
  strategySuggestions: ["Lead with the conclusion."],
  weakTags: ["metrics"],
  nextTrainingPlan: {
    focus: "Evidence",
    drills: ["Rewrite one answer"],
    recommendedStages: ["FORMAL_INTERVIEW"]
  },
  candidateSummary: "Solid baseline."
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function loadRoutes() {
  vi.resetModules();

  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    trainingTask: {
      findUnique: vi.fn()
    },
    trainingSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    sessionTurn: {
      findFirst: vi.fn(),
      create: vi.fn()
    },
    coachingReport: {
      upsert: vi.fn()
    },
    aiCallLog: {
      create: vi.fn()
    }
  };

  const aiOrchestrator = {
    generateTrainingOutline: vi.fn(),
    generateCoachingReport: vi.fn()
  };

  vi.doMock("@/lib/db/prisma", () => ({ prisma }));
  vi.doMock("@/lib/ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/ai")>();

    return {
      ...actual,
      aiOrchestrator,
      default: aiOrchestrator
    };
  });

  const sessionsRoute = await import("@/app/api/sessions/route");
  const answerRoute = await import("@/app/api/sessions/[sessionId]/answer/route");
  const completeRoute = await import("@/app/api/sessions/[sessionId]/complete/route");

  return { prisma, aiOrchestrator, sessionsRoute, answerRoute, completeRoute };
}

describe("session API routes", () => {
  it("creates a training session and outline from a valid task", async () => {
    const { prisma, aiOrchestrator, sessionsRoute } = await loadRoutes();
    prisma.trainingTask.findUnique.mockResolvedValue({
      id: "task-1",
      candidateId: "candidate-1",
      title: "PM interview",
      targetCompany: "Acme",
      targetRole: "Product Manager",
      expectedMinutes: 30,
      stageConfig: validStageConfig,
      candidate: { id: "candidate-1", name: "Ada", targetRole: "Product Manager" },
      interviewerTemplate: { id: "interviewer-1", name: "Senior PM", languageMode: "zh-CN" },
      companyTemplate: null,
      jobTemplate: null
    });
    aiOrchestrator.generateTrainingOutline.mockResolvedValue(outline);
    prisma.trainingSession.create.mockResolvedValue({
      id: "session-1",
      taskId: "task-1",
      candidateId: "candidate-1",
      status: "IN_PROGRESS",
      currentStage: "WARM_UP"
    });

    const response = await sessionsRoute.POST(jsonRequest({ taskId: "task-1" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(aiOrchestrator.generateTrainingOutline).toHaveBeenCalledWith({
      targetRole: "Product Manager",
      targetCompany: "Acme",
      stages: ["WARM_UP", "FORMAL_INTERVIEW", "AI_REVIEW"],
      questionCountPerStage: 1,
      preferredLanguage: "zh-CN"
    });
    expect(prisma.trainingSession.create).toHaveBeenCalledWith({
      data: {
        taskId: "task-1",
        candidateId: "candidate-1",
        currentStage: "WARM_UP"
      }
    });
    expect(prisma.aiCallLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: "task-1",
          sessionId: "session-1",
          capability: "TRAINING_OUTLINE",
          success: true
        })
      })
    );
    expect(body).toEqual({
      session: {
        id: "session-1",
        taskId: "task-1",
        candidateId: "candidate-1",
        status: "IN_PROGRESS",
        currentStage: "WARM_UP"
      },
      outline
    });
  });

  it("rejects empty answer submissions before writing a turn", async () => {
    const { prisma, answerRoute } = await loadRoutes();

    const response = await answerRoute.POST(jsonRequest({ stage: "WARM_UP", question: "Question?", answer: " " }), {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(400);
    expect(prisma.sessionTurn.create).not.toHaveBeenCalled();
  });

  it("rejects answer submissions for completed sessions", async () => {
    const { prisma, answerRoute } = await loadRoutes();
    prisma.trainingSession.findUnique.mockResolvedValue({
      id: "session-1",
      status: "COMPLETED"
    });

    const response = await answerRoute.POST(
      jsonRequest({ stage: "WARM_UP", question: "Question?", answer: "Answer." }),
      {
        params: Promise.resolve({ sessionId: "session-1" })
      }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Session is not accepting answers" });
    expect(prisma.sessionTurn.create).not.toHaveBeenCalled();
    expect(prisma.trainingSession.update).not.toHaveBeenCalled();
  });

  it("generates and stores a report when completing a session", async () => {
    const { prisma, aiOrchestrator, completeRoute } = await loadRoutes();
    prisma.trainingSession.findUnique.mockResolvedValue({
      id: "session-1",
      taskId: "task-1",
      candidateId: "candidate-1",
      task: {
        id: "task-1",
        targetRole: "Product Manager",
        targetCompany: "Acme"
      },
      candidate: { id: "candidate-1", name: "Ada" },
      turns: [
        {
          id: "turn-1",
          stage: "WARM_UP",
          question: "Introduce yourself.",
          answer: "I build products.",
          feedback: null
        }
      ]
    });
    aiOrchestrator.generateCoachingReport.mockResolvedValue(report);
    prisma.coachingReport.upsert.mockResolvedValue({ id: "report-1", sessionId: "session-1" });
    prisma.trainingSession.update.mockResolvedValue({ id: "session-1", status: "COMPLETED" });

    const response = await completeRoute.POST(jsonRequest({}), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(aiOrchestrator.generateCoachingReport).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetRole: "Product Manager",
      targetCompany: "Acme",
      turns: [
        {
          stage: "WARM_UP",
          question: "Introduce yourself.",
          answer: "I build products."
        }
      ]
    });
    expect(prisma.coachingReport.upsert).toHaveBeenCalledWith({
      where: { sessionId: "session-1" },
      update: expect.objectContaining({
        overallScore: 82,
        weakTags: JSON.stringify(["metrics"])
      }),
      create: expect.objectContaining({
        sessionId: "session-1",
        overallScore: 82,
        weakTags: JSON.stringify(["metrics"])
      })
    });
    expect(prisma.trainingSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        endedAt: expect.any(Date)
      })
    });
    expect(prisma.aiCallLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: "session-1",
          reportId: "report-1",
          capability: "COACHING_REPORT",
          success: true
        })
      })
    );
    expect(body).toEqual({ report });
  });

  it("returns an existing report when completing an already completed session", async () => {
    const { prisma, aiOrchestrator, completeRoute } = await loadRoutes();
    const storedReport = {
      id: "report-1",
      sessionId: "session-1",
      overallScore: report.overallScore,
      subScores: JSON.stringify(report.subScores),
      perQuestionFeedback: JSON.stringify(report.perQuestionFeedback),
      expressionAnalysis: JSON.stringify(report.expressionAnalysis),
      answerQualityAnalysis: JSON.stringify(report.answerQualityAnalysis),
      strategySuggestions: JSON.stringify(report.strategySuggestions),
      weakTags: JSON.stringify(report.weakTags),
      nextTrainingPlan: JSON.stringify(report.nextTrainingPlan),
      candidateSummary: report.candidateSummary
    };
    prisma.trainingSession.findUnique.mockResolvedValue({
      id: "session-1",
      taskId: "task-1",
      candidateId: "candidate-1",
      status: "COMPLETED",
      report: storedReport,
      task: {
        id: "task-1",
        targetRole: "Product Manager",
        targetCompany: "Acme"
      },
      candidate: { id: "candidate-1", name: "Ada" },
      turns: []
    });

    const response = await completeRoute.POST(jsonRequest({}), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ report });
    expect(aiOrchestrator.generateCoachingReport).not.toHaveBeenCalled();
    expect(prisma.coachingReport.upsert).not.toHaveBeenCalled();
    expect(prisma.trainingSession.update).not.toHaveBeenCalled();
    expect(prisma.aiCallLog.create).not.toHaveBeenCalled();
  });
});

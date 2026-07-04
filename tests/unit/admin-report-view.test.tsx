import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "@/components/admin/ReportView";
import { serializeCoachingReportForStorage, type CoachingReportResult } from "@/lib/ai";

const root = process.cwd();

const report: CoachingReportResult = {
  overallScore: 87,
  subScores: {
    expressionStructure: 82,
    contentRelevance: 90,
    confidence: 84,
    pressureHandling: 81,
    roleFit: 91
  },
  perQuestionFeedback: [
    {
      questionId: "warm-up-1",
      stage: "WARM_UP",
      score: 86,
      strengths: ["Clear opening"],
      improvements: ["Add one quantified outcome"]
    }
  ],
  expressionAnalysis: {
    summary: "The answer is easy to follow.",
    strongPoints: ["Structured opening"],
    improvementPoints: ["Tighter conclusion"]
  },
  answerQualityAnalysis: {
    summary: "Examples match the role.",
    evidence: ["Named product launch context"],
    gaps: ["Missing metric"]
  },
  strategySuggestions: ["Lead with the business outcome."],
  weakTags: ["metrics", "pressure"],
  nextTrainingPlan: {
    focus: "Quantified product stories",
    drills: ["Rewrite two STAR answers"],
    recommendedStages: ["FORMAL_INTERVIEW"]
  },
  candidateSummary: "Strong baseline with room to sharpen evidence."
};

const sessionWithReport = {
  id: "session-1",
  status: "COMPLETED",
  currentStage: "AI_REVIEW",
  startedAt: new Date("2026-07-04T08:00:00.000Z"),
  endedAt: new Date("2026-07-04T08:30:00.000Z"),
  candidate: {
    id: "candidate-1",
    name: "Ada Lovelace",
    targetCompany: "Acme",
    targetRole: "Product Manager"
  },
  task: {
    id: "task-1",
    title: "PM final round practice",
    targetCompany: "Acme",
    targetRole: "Product Manager"
  },
  turns: [
    {
      id: "turn-1",
      stage: "WARM_UP",
      question: "Introduce yourself.",
      answer: "I build products that improve retention.",
      feedback: "Good structure.",
      createdAt: new Date("2026-07-04T08:03:00.000Z")
    }
  ],
  report: {
    id: "report-1",
    sessionId: "session-1",
    createdAt: new Date("2026-07-04T08:31:00.000Z"),
    ...serializeCoachingReportForStorage(report)
  }
};

describe("ReportView", () => {
  it("renders the complete backend report and transcript summary", () => {
    const markup = renderToStaticMarkup(<ReportView session={sessionWithReport} />);

    expect(markup).toContain("PM final round practice");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Acme");
    expect(markup).toContain("Product Manager");
    expect(markup).toContain("87");
    expect(markup).toContain("Expression structure");
    expect(markup).toContain("Content relevance");
    expect(markup).toContain("Clear opening");
    expect(markup).toContain("Lead with the business outcome.");
    expect(markup).toContain("metrics");
    expect(markup).toContain("Quantified product stories");
    expect(markup).toContain("Introduce yourself.");
    expect(markup).toContain("I build products that improve retention.");
  });

  it("renders a clear not generated yet state when the session has no report", () => {
    const markup = renderToStaticMarkup(<ReportView session={{ ...sessionWithReport, report: null }} />);

    expect(markup).toContain("Report not generated yet");
    expect(markup).toContain("This session has no backend coaching report yet.");
  });

  it("preserves the header and transcript when stored report JSON is malformed", () => {
    const markup = renderToStaticMarkup(
      <ReportView
        session={{
          ...sessionWithReport,
          report: {
            ...sessionWithReport.report,
            perQuestionFeedback: "{not json"
          }
        }}
      />
    );

    expect(markup).toContain("PM final round practice");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("报告数据格式异常");
    expect(markup).toContain("Invalid report data");
    expect(markup).toContain("Introduce yourself.");
    expect(markup).toContain("I build products that improve retention.");
  });

  it("preserves the header and transcript when stored report JSON has the wrong shape", () => {
    const markup = renderToStaticMarkup(
      <ReportView
        session={{
          ...sessionWithReport,
          report: {
            ...sessionWithReport.report,
            subScores: JSON.stringify({
              expressionStructure: "high",
              contentRelevance: 90,
              confidence: 84,
              pressureHandling: 81,
              roleFit: 91
            })
          }
        }}
      />
    );

    expect(markup).toContain("PM final round practice");
    expect(markup).toContain("报告数据格式异常");
    expect(markup).toContain("Invalid report data");
    expect(markup).toContain("Introduce yourself.");
  });

  it("renders an empty state when a report has no per-question feedback", () => {
    const reportWithoutQuestionFeedback: CoachingReportResult = {
      ...report,
      perQuestionFeedback: []
    };

    const markup = renderToStaticMarkup(
      <ReportView
        session={{
          ...sessionWithReport,
          report: {
            ...sessionWithReport.report,
            ...serializeCoachingReportForStorage(reportWithoutQuestionFeedback)
          }
        }}
      />
    );

    expect(markup).toContain("Per-question feedback");
    expect(markup).toContain("No per-question feedback was generated for this report.");
  });
});

describe("admin report page", () => {
  it("loads the session by id with report relations and ascending turns", async () => {
    vi.resetModules();
    const prisma = {
      trainingSession: {
        findUnique: vi.fn().mockResolvedValue(sessionWithReport)
      }
    };

    vi.doMock("@/lib/db/prisma", () => ({ prisma }));
    vi.doMock("next/navigation", () => ({
      notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
      })
    }));

    const page = await import("@/app/admin/reports/[sessionId]/page");
    const element = await page.default({ params: Promise.resolve({ sessionId: "session-1" }) });
    const markup = renderToStaticMarkup(element);

    expect(prisma.trainingSession.findUnique).toHaveBeenCalledWith({
      where: { id: "session-1" },
      include: {
        candidate: true,
        task: true,
        turns: {
          orderBy: { createdAt: "asc" }
        },
        report: true
      }
    });
    expect(markup).toContain("PM final round practice");
  });

  it("404s when the session is missing", async () => {
    vi.resetModules();
    const prisma = {
      trainingSession: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    };

    vi.doMock("@/lib/db/prisma", () => ({ prisma }));
    vi.doMock("next/navigation", () => ({
      notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
      })
    }));

    const page = await import("@/app/admin/reports/[sessionId]/page");

    await expect(page.default({ params: Promise.resolve({ sessionId: "missing" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
  });
});

describe("task detail report links", () => {
  it("links only reported sessions to the admin report route", () => {
    const source = readFileSync(join(root, "app/admin/tasks/[taskId]/page.tsx"), "utf8");

    expect(source).toContain("session.report ? (");
    expect(source).toContain('href={`/admin/reports/${session.id}` as Route}');
    expect(source).toContain("Report not generated yet");
  });
});

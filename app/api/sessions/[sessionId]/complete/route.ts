import { NextResponse } from "next/server";
import {
  aiOrchestrator,
  deserializeStoredCoachingReport,
  serializeCoachingReportForStorage
} from "@/lib/ai";
import { resolveAiProviderLabel } from "@/lib/ai/configResolver";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { behaviorSignalsSchema } from "@/lib/domain/behaviorSignals";
import type { TrainingStageType } from "@/lib/domain/stages";
import { stopDigitalHumanSessionsForTrainingSession } from "@/lib/media/digitalHumanSessions";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

async function safelyCleanupDigitalHumanSessions(trainingSessionId: string) {
  await stopDigitalHumanSessionsForTrainingSession(
    trainingSessionId,
    "TRAINING_COMPLETED"
  ).catch(() => {
    console.warn("DIGITAL_HUMAN_TRAINING_CLEANUP_FAILED");
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const startedAt = Date.now();
  const { sessionId } = await context.params;
  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    return NextResponse.json({ error: "Session is required" }, { status: 400 });
  }

  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: normalizedSessionId },
      include: {
        candidate: true,
        report: true,
        task: true,
      turns: {
        orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.status === "COMPLETED" && session.report) {
      await safelyCleanupDigitalHumanSessions(session.id);
      return NextResponse.json({ report: deserializeStoredCoachingReport(session.report) });
    }

    if (session.turns.length === 0) {
      return NextResponse.json({ error: "Cannot complete a session with no answers" }, { status: 400 });
    }

    const report = await aiOrchestrator.generateCoachingReport({
      sessionId: session.id,
      targetRole: session.task.targetRole,
      targetCompany: session.task.targetCompany,
      turns: session.turns.map((turn) => ({
        questionId: turn.questionId ?? undefined,
        stage: turn.stage as TrainingStageType,
        question: turn.question,
        answer: turn.answer,
        behaviorSignals: parseBehaviorSignals(turn.behaviorSignalsJson)
      }))
    });
    const storedReport = serializeCoachingReportForStorage(report);

    const completion = await prisma.$transaction(async (tx) => {
      const currentSession = await tx.trainingSession.findUnique({
        where: { id: session.id },
        include: { report: true }
      });

      if (currentSession?.status === "COMPLETED" && currentSession.report) {
        return {
          report: deserializeStoredCoachingReport(currentSession.report),
          coachingReport: currentSession.report,
          stored: false
        };
      }

      const coachingReport = await tx.coachingReport.upsert({
        where: { sessionId: session.id },
        update: storedReport,
        create: {
          sessionId: session.id,
          ...storedReport
        }
      });

      await tx.trainingSession.update({
        where: { id: session.id },
        data: {
          status: "COMPLETED",
          endedAt: new Date()
        }
      });

      return { report, coachingReport, stored: true };
    });

    if (completion.stored) {
      await prisma.aiCallLog.create({
        data: {
          taskId: session.taskId,
          sessionId: session.id,
          reportId: completion.coachingReport.id,
          capability: "COACHING_REPORT",
          provider: await resolveAiProviderLabel("REPORT_ANALYSIS"),
          latencyMs: Date.now() - startedAt,
          costEstimate: 0,
          success: true
        }
      });
    }
    await safelyCleanupDigitalHumanSessions(session.id);

    return NextResponse.json({ report: completion.report });
  } catch (error) {
    await prisma.aiCallLog
      .create({
        data: {
          sessionId: normalizedSessionId,
          capability: "COACHING_REPORT",
          provider: await resolveAiProviderLabel("REPORT_ANALYSIS"),
          latencyMs: Date.now() - startedAt,
          costEstimate: 0,
          success: false,
          failureReason: error instanceof Error ? error.message : "Unknown error"
        }
      })
      .catch(() => undefined);

    return postErrorResponse(error);
  }
}

function parseBehaviorSignals(value: string | null) {
  if (!value) {
    return undefined;
  }

  try {
    return behaviorSignalsSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

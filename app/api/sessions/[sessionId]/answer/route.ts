import { NextResponse } from "next/server";
import { z } from "zod";
import { aiOrchestrator } from "@/lib/ai";
import { resolveAiProviderLabel } from "@/lib/ai/configResolver";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { trainingStageTypes } from "@/lib/domain/stages";
import type { SessionTurnInput, TrainingOutline } from "@/lib/ai";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

const answerSchema = z
  .object({
    questionId: z.string().trim().min(1, "Question id is required"),
    stage: z.enum(trainingStageTypes),
    question: z.string().trim().min(1, "Question is required"),
    answer: z.string().trim().min(1, "Answer is required"),
    feedback: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined))
  })
  .strict();

function parseSavedOutline(outlineJson: string | null): TrainingOutline | null {
  if (!outlineJson) {
    return null;
  }

  try {
    const outline = JSON.parse(outlineJson) as TrainingOutline;

    return Array.isArray(outline.questions) ? outline : null;
  } catch {
    return null;
  }
}

function matchesSavedQuestion(
  input: z.infer<typeof answerSchema>,
  outline: TrainingOutline,
  turns: Array<{ questionId: string | null; stage: string; feedback: string | null }>
) {
  const savedQuestion = outline.questions.find((question) => question.id === input.questionId);

  if (savedQuestion) {
    return savedQuestion.stage === input.stage && savedQuestion.prompt === input.question;
  }

  const match = input.questionId.match(/^(.*)::follow-up::1$/);

  if (!match) {
    return false;
  }

  const parentQuestion = outline.questions.find((question) => question.id === match[1]);
  const parentTurn = turns.find((turn) => turn.questionId === match[1]);

  if (!parentQuestion || !parentTurn || parentTurn.stage !== input.stage || !parentTurn.feedback) {
    return false;
  }

  try {
    const feedback = JSON.parse(parentTurn.feedback) as { followUpQuestion?: unknown };

    return typeof feedback.followUpQuestion === "string" && feedback.followUpQuestion === input.question;
  } catch {
    return false;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const startedAt = Date.now();

  try {
    const { sessionId } = await context.params;
    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return NextResponse.json({ error: "Session is required" }, { status: 400 });
    }

    const input = answerSchema.parse(await request.json());
    const session = await prisma.trainingSession.findUnique({
      where: { id: normalizedSessionId },
      include: {
        task: {
          select: {
            id: true,
            targetRole: true,
            targetCompany: true
          }
        },
        turns: {
          orderBy: { createdAt: "asc" },
          select: {
            questionId: true,
            stage: true,
            question: true,
            answer: true,
            feedback: true
          }
        }
      }
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Session is not accepting answers" }, { status: 409 });
    }

    const outline = parseSavedOutline(session.outlineJson);

    if (!outline) {
      return NextResponse.json({ error: "Session outline is unavailable" }, { status: 409 });
    }

    if (!matchesSavedQuestion(input, outline, session.turns)) {
      return NextResponse.json({ error: "Unknown session question" }, { status: 400 });
    }

    const existingTurn = await prisma.sessionTurn.findUnique({
      where: {
        sessionId_questionId: {
          sessionId: normalizedSessionId,
          questionId: input.questionId
        }
      },
      select: { id: true }
    });

    if (existingTurn) {
      return NextResponse.json({ error: "Answer already submitted for this question" }, { status: 409 });
    }

    const coaching = await aiOrchestrator.generateFollowUpCoaching({
      sessionId: normalizedSessionId,
      targetRole: session.task.targetRole,
      targetCompany: session.task.targetCompany,
      currentTurn: {
        questionId: input.questionId,
        stage: input.stage,
        question: input.question,
        answer: input.answer
      },
      previousTurns: session.turns.map(
        (turn): SessionTurnInput => ({
          stage: turn.stage as SessionTurnInput["stage"],
          questionId: turn.questionId ?? undefined,
          question: turn.question,
          answer: turn.answer
        })
      )
    });
    const feedback = JSON.stringify(coaching);

    const turn = await prisma.$transaction(async (tx) => {
      const createdTurn = await tx.sessionTurn.create({
        data: {
          sessionId: normalizedSessionId,
          questionId: input.questionId,
          stage: input.stage,
          question: input.question,
          answer: input.answer,
          feedback: input.feedback ?? feedback
        }
      });

      await tx.trainingSession.update({
        where: { id: normalizedSessionId },
        data: { currentStage: input.stage }
      });

      return createdTurn;
    });

    await prisma.aiCallLog.create({
      data: {
        taskId: session.task.id,
        sessionId: normalizedSessionId,
        capability: "INTERVIEW_FOLLOW_UP",
        provider: await resolveAiProviderLabel("INTERVIEW_FOLLOW_UP"),
        latencyMs: Date.now() - startedAt,
        costEstimate: 0,
        success: true
      }
    });

    return NextResponse.json({ turn, coaching }, { status: 201 });
  } catch (error) {
    const { sessionId } = await context.params.catch(() => ({ sessionId: "" }));

    await prisma.aiCallLog
      .create({
        data: {
          sessionId: sessionId.trim() || undefined,
          capability: "INTERVIEW_FOLLOW_UP",
          provider: await resolveAiProviderLabel("INTERVIEW_FOLLOW_UP"),
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

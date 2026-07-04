import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { trainingStageTypes } from "@/lib/domain/stages";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

const answerSchema = z
  .object({
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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return NextResponse.json({ error: "Session is required" }, { status: 400 });
    }

    const input = answerSchema.parse(await request.json());
    const session = await prisma.trainingSession.findUnique({
      where: { id: normalizedSessionId },
      select: { id: true, status: true }
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Session is not accepting answers" }, { status: 409 });
    }

    const existingTurn = await prisma.sessionTurn.findFirst({
      where: {
        sessionId: normalizedSessionId,
        stage: input.stage,
        question: input.question
      },
      select: { id: true }
    });

    if (existingTurn) {
      return NextResponse.json({ error: "Answer already submitted for this question" }, { status: 409 });
    }

    const turn = await prisma.$transaction(async (tx) => {
      const createdTurn = await tx.sessionTurn.create({
        data: {
          sessionId: normalizedSessionId,
          stage: input.stage,
          question: input.question,
          answer: input.answer,
          feedback: input.feedback
        }
      });

      await tx.trainingSession.update({
        where: { id: normalizedSessionId },
        data: { currentStage: input.stage }
      });

      return createdTurn;
    });

    return NextResponse.json({ turn }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}

import type { PrismaClient } from "@prisma/client";
import type { TrainingOutline } from "@/lib/ai";
import { buildOutlineRenderPlaceholders } from "./renderRequests";

type SessionPlaceholderClient = Pick<PrismaClient, "$transaction">;

export async function persistSessionWithRenderPlaceholders(
  client: SessionPlaceholderClient,
  input: {
    taskId: string;
    candidateId: string;
    currentStage: string;
    outline: TrainingOutline;
  }
) {
  return client.$transaction(async (tx) => {
    const session = await tx.trainingSession.create({
      data: {
        taskId: input.taskId,
        candidateId: input.candidateId,
        currentStage: input.currentStage,
        outlineJson: JSON.stringify(input.outline)
      }
    });
    const placeholders = buildOutlineRenderPlaceholders(session.id, input.outline.questions);
    if (placeholders.length > 0) {
      await tx.digitalHumanRenderPlaceholder.createMany({ data: placeholders });
    }
    return session;
  });
}

export async function persistAnswerWithDynamicPlaceholder(
  client: SessionPlaceholderClient,
  input: {
    sessionId: string;
    questionId: string;
    stage: string;
    question: string;
    answer: string;
    behaviorSignalsJson?: string;
    feedback: string;
    dynamicPlaceholder: ReturnType<typeof import("./renderRequests")["buildDynamicRenderPlaceholder"]> | null;
  }
) {
  return client.$transaction(async (tx) => {
    const turn = await tx.sessionTurn.create({
      data: {
        sessionId: input.sessionId,
        questionId: input.questionId,
        stage: input.stage,
        question: input.question,
        answer: input.answer,
        behaviorSignalsJson: input.behaviorSignalsJson,
        feedback: input.feedback
      }
    });
    await tx.trainingSession.update({
      where: { id: input.sessionId },
      data: { currentStage: input.stage }
    });
    if (input.dynamicPlaceholder) {
      await tx.digitalHumanRenderPlaceholder.create({ data: input.dynamicPlaceholder });
    }
    return turn;
  });
}

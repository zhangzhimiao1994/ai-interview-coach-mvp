import type { TrainingOutline, TrainingQuestion } from "@/lib/ai";
import {
  trainingStageTypes,
  type TrainingStageType
} from "@/lib/domain/stages";

type SessionQuestionTurn = {
  questionId: string | null;
  stage: string;
  feedback: string | null;
};

export function parseSavedOutline(
  outlineJson: string | null
): TrainingOutline | null {
  if (!outlineJson) return null;

  try {
    const outline = JSON.parse(outlineJson) as TrainingOutline;
    return Array.isArray(outline.questions) ? outline : null;
  } catch {
    return null;
  }
}

export function resolveSessionQuestion(
  outline: TrainingOutline,
  questionId: string,
  turns: SessionQuestionTurn[]
): TrainingQuestion | null {
  const savedQuestion = outline.questions.find(
    (question) => question.id === questionId
  );
  if (savedQuestion) return savedQuestion;

  const followUp = questionId.match(/^(.*)::follow-up::1$/);
  if (!followUp) return null;

  const parentQuestion = outline.questions.find(
    (question) => question.id === followUp[1]
  );
  const parentTurn = turns.find((turn) => turn.questionId === followUp[1]);
  if (
    !parentQuestion ||
    !parentTurn ||
    !trainingStageTypes.includes(parentTurn.stage as TrainingStageType) ||
    !parentTurn.feedback
  ) {
    return null;
  }

  try {
    const feedback = JSON.parse(parentTurn.feedback) as {
      followUpQuestion?: unknown;
    };
    if (
      typeof feedback.followUpQuestion !== "string" ||
      !feedback.followUpQuestion.trim()
    ) {
      return null;
    }
    return {
      ...parentQuestion,
      id: questionId,
      stage: parentTurn.stage as TrainingStageType,
      prompt: feedback.followUpQuestion,
      followUps: []
    };
  } catch {
    return null;
  }
}

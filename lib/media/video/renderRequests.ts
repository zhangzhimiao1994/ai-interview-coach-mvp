import { createHash } from "node:crypto";

type QuestionSource = { id: string; stage: string; prompt: string };

function boundedText(value: string, label: string, max = 20_000) {
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} is invalid`);
  return text;
}

export function deterministicRenderIdentity(
  questionId: string,
  questionText: string,
  kind: "PRESET" | "DYNAMIC"
) {
  const id = boundedText(questionId, "Question id", 200);
  const text = boundedText(questionText, "Question text");
  const questionHash = createHash("sha256")
    .update(JSON.stringify({ id, text }))
    .digest("hex");
  return { questionHash, cacheKey: `${kind.toLowerCase()}:${questionHash}` };
}

export function buildOutlineRenderPlaceholders(
  trainingSessionId: string,
  questions: QuestionSource[]
) {
  const sessionId = boundedText(trainingSessionId, "Training session id", 200);
  const seen = new Set<string>();
  return questions.map((question) => {
    const questionId = boundedText(question.id, "Question id", 200);
    if (seen.has(questionId)) throw new Error("Outline contains duplicate question ids");
    seen.add(questionId);
    const questionText = boundedText(question.prompt, "Question text");
    const stage = boundedText(question.stage, "Question stage", 100);
    return {
      trainingSessionId: sessionId,
      questionId,
      ...deterministicRenderIdentity(questionId, questionText, "PRESET"),
      kind: "PRESET" as const,
      stage,
      questionText,
      status: "PENDING" as const
    };
  });
}

export function followUpRenderQuestion(parentQuestionId: string, text: string) {
  return {
    id: `${boundedText(parentQuestionId, "Parent question id", 180)}::follow-up::1`,
    text: boundedText(text, "Follow-up question")
  };
}

export function buildDynamicRenderPlaceholder(input: {
  trainingSessionId: string;
  parentQuestionId: string;
  stage: string;
  text: string;
  behaviorSignals?: Record<string, unknown>;
}) {
  const followUp = followUpRenderQuestion(input.parentQuestionId, input.text);
  return {
    trainingSessionId: boundedText(input.trainingSessionId, "Training session id", 200),
    questionId: followUp.id,
    ...deterministicRenderIdentity(followUp.id, followUp.text, "DYNAMIC"),
    kind: "DYNAMIC" as const,
    stage: boundedText(input.stage, "Question stage", 100),
    questionText: followUp.text,
    behaviorSignalsJson: input.behaviorSignals ? JSON.stringify(input.behaviorSignals) : null,
    status: "PENDING" as const
  };
}

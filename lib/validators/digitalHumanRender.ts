import { z } from "zod";

const identifier = z.string().trim().min(1).max(200);

export const createRenderRequestSchema = z.object({
  sessionId: identifier,
  questionId: identifier,
  kind: z.enum(["PRESET", "DYNAMIC"])
}).strict();

export const prewarmRenderRequestSchema = z.object({
  sessionId: identifier,
  currentQuestionId: identifier
}).strict();

export function parseCreateRenderRequest(value: unknown) {
  return createRenderRequestSchema.parse(value);
}

export function parsePrewarmRenderRequest(value: unknown) {
  return prewarmRenderRequestSchema.parse(value);
}

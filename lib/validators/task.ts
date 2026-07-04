import { z } from "zod";
import { parseStageConfigInput } from "@/lib/domain/stages";

const optionalId = z.preprocess(
  (value) => (value === null || (typeof value === "string" && value.trim() === "") ? undefined : value),
  z.string().trim().min(1).optional()
);

const requiredText = (fieldName: string) => z.string().trim().min(1, `${fieldName} is required`);

export const trainingTaskInputSchema = z
  .object({
    candidateId: requiredText("Candidate"),
    companyTemplateId: optionalId,
    jobTemplateId: optionalId,
    interviewerTemplateId: optionalId,
    title: requiredText("Title"),
    targetCompany: requiredText("Target company"),
    targetRole: requiredText("Target role"),
    stageConfig: z.unknown().transform((value, ctx) => {
      if (value === undefined || value === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stage config is required"
        });
        return z.NEVER;
      }

      try {
        return JSON.stringify(parseStageConfigInput(value));
      } catch (error) {
        if (error instanceof z.ZodError) {
          error.issues.forEach((issue) => {
            ctx.addIssue({
              ...issue,
              path: issue.path
            });
          });
          return z.NEVER;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : "Invalid stage config"
        });
        return z.NEVER;
      }
    }),
    expectedMinutes: z
      .number({
        required_error: "Expected minutes is required",
        invalid_type_error: "Expected minutes must be a number"
      })
      .int("Expected minutes must be an integer")
      .min(5, "Expected minutes must be at least 5")
      .max(120, "Expected minutes must be at most 120")
  })
  .strict();

export type TrainingTaskInput = z.infer<typeof trainingTaskInputSchema>;

export function parseTrainingTaskInput(input: unknown): TrainingTaskInput {
  return trainingTaskInputSchema.parse(input);
}

import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const requiredText = (fieldName: string) => z.string().trim().min(1, `${fieldName} is required`);

export const companyTemplateInputSchema = z
  .object({
    name: requiredText("Name"),
    industry: optionalText,
    interviewStyle: requiredText("Interview style"),
    competencyModel: requiredText("Competency model"),
    commonQuestions: requiredText("Common questions"),
    scoringStandard: requiredText("Scoring standard"),
    restrictedTopics: z
      .preprocess(
        (value) => (value === undefined || value === null || value === "" ? "[]" : value),
        z.string().trim().min(1)
      )
      .default("[]")
  })
  .strict();

export const jobTemplateInputSchema = z
  .object({
    title: requiredText("Title"),
    category: requiredText("Category"),
    competencyModel: requiredText("Competency model"),
    commonQuestions: requiredText("Common questions"),
    riskQuestions: requiredText("Risk questions")
  })
  .strict();

export type CompanyTemplateInput = z.infer<typeof companyTemplateInputSchema>;
export type JobTemplateInput = z.infer<typeof jobTemplateInputSchema>;

export function parseCompanyTemplateInput(input: unknown): CompanyTemplateInput {
  return companyTemplateInputSchema.parse(input);
}

export function parseJobTemplateInput(input: unknown): JobTemplateInput {
  return jobTemplateInputSchema.parse(input);
}

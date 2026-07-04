import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().email().optional()
);

export const candidateInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: optionalEmail,
    phone: optionalText,
    targetCompany: optionalText,
    targetRole: optionalText
  })
  .strict();

export type CandidateInput = z.infer<typeof candidateInputSchema>;

export function parseCandidateInput(input: unknown): CandidateInput {
  return candidateInputSchema.parse(input);
}

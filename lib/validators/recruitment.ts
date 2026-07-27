import { z } from "zod";
import { canonicalizeJobUrl } from "@/lib/recruitment/normalization";
import { createManualRecruitmentPostingInput } from "@/lib/recruitment/postings";

const optionalText = z.preprocess(
  (value) => (value === null || (typeof value === "string" && value.trim() === "") ? undefined : value),
  z.string().trim().optional()
);

const optionalPublicUrl = optionalText.refine((value) => {
  if (value === undefined) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "Source URL must be a public HTTP(S) URL");

export const manualRecruitmentPostingInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    company: optionalText,
    location: optionalText,
    salary: optionalText,
    description: z.string().trim().min(1, "Description is required"),
    requirementsText: optionalText,
    sourceUrl: optionalPublicUrl.transform((value) => (value ? canonicalizeJobUrl(value) : undefined)),
    notes: optionalText
  })
  .strict()
  .transform((input) => createManualRecruitmentPostingInput(input));

export function parseManualRecruitmentPostingInput(input: unknown) {
  return manualRecruitmentPostingInputSchema.parse(input);
}

export const recruitmentPostingUpdateInputSchema = z
  .object({
    title: optionalText,
    company: optionalText.nullable().optional(),
    location: optionalText.nullable().optional(),
    salary: optionalText.nullable().optional(),
    description: optionalText,
    requirementsText: optionalText,
    sourceUrl: optionalPublicUrl.nullable().optional(),
    notes: optionalText.nullable().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional()
  })
  .strict();

export function parseRecruitmentPostingUpdateInput(input: unknown) {
  return recruitmentPostingUpdateInputSchema.parse(input);
}

export function parseRecruitmentPostingListQuery(url: URL) {
  return {
    provider: url.searchParams.get("provider") || undefined,
    sourceType: url.searchParams.get("sourceType") || undefined,
    company: url.searchParams.get("company") || undefined,
    keyword: url.searchParams.get("keyword") || undefined,
    status: url.searchParams.get("status") || "ACTIVE"
  };
}

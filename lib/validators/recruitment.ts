import { z } from "zod";
import { canonicalizeJobUrl } from "@/lib/recruitment/normalization";
import { recruitmentSourceTypes } from "@/lib/recruitment/types";
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

const recruitmentProviders = [
  "adzuna",
  "jooble",
  "greenhouse",
  "lever",
  "usajobs",
  "manual",
  "boss",
  "liepin",
  "zhaopin",
  "linkedin"
] as const;

const settingsSchema = z.record(z.unknown()).default({});

export const recruitmentSourceInputSchema = z
  .object({
    provider: z.enum(recruitmentProviders),
    sourceType: z.enum(recruitmentSourceTypes),
    displayName: z.string().trim().min(1, "Display name is required"),
    apiKey: optionalText.pipe(z.string().min(16).optional()),
    sessionState: optionalText.pipe(z.string().min(16).optional()),
    enabled: z.boolean().optional(),
    settings: settingsSchema
  })
  .strict();

export type RecruitmentSourceInput = z.infer<typeof recruitmentSourceInputSchema>;

export function parseRecruitmentSourceInput(input: unknown) {
  return recruitmentSourceInputSchema.parse(input);
}

export const recruitmentSourcePatchInputSchema = z
  .object({
    displayName: optionalText,
    enabled: z.boolean().optional(),
    apiKey: optionalText.pipe(z.string().min(16).optional()),
    sessionState: optionalText.pipe(z.string().min(16).optional()),
    settings: settingsSchema.optional(),
    verificationStatus: z.enum(["UNVERIFIED", "VERIFIED", "AUTH_REQUIRED", "PAUSED", "FAILED"]).optional()
  })
  .strict();

export function parseRecruitmentSourcePatchInput(input: unknown) {
  return recruitmentSourcePatchInputSchema.parse(input);
}

export type RecruitmentSourceRecord = {
  id: string;
  provider: string;
  sourceType: string;
  displayName: string;
  enabled: boolean;
  credentialPreview: string | null;
  sessionPreview: string | null;
  verificationStatus: string;
  lastVerifiedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  settingsJson: string;
  createdAt: Date;
  updatedAt: Date;
};

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export function serializeRecruitmentSource(source: RecruitmentSourceRecord) {
  return {
    id: source.id,
    provider: source.provider,
    sourceType: source.sourceType,
    displayName: source.displayName,
    enabled: source.enabled,
    credentialPreview: source.credentialPreview,
    sessionPreview: source.sessionPreview,
    verificationStatus: source.verificationStatus,
    lastVerifiedAt: toIso(source.lastVerifiedAt),
    lastSuccessfulSyncAt: toIso(source.lastSuccessfulSyncAt),
    settings: parseJsonObject(source.settingsJson),
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString()
  };
}

export const recruitmentTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required"),
    keywords: z.string().trim().min(1, "Keywords are required"),
    roleType: optionalText,
    city: optionalText,
    country: optionalText,
    experienceRange: optionalText,
    salaryRange: optionalText,
    language: optionalText,
    remoteMode: optionalText,
    sourceIds: z.array(z.string().trim().min(1)).default([]),
    candidateIds: z.array(z.string().trim().min(1)).default([]),
    enabled: z.boolean().default(true)
  })
  .strict();

export function parseRecruitmentTemplateInput(input: unknown) {
  return recruitmentTemplateInputSchema.parse(input);
}

export type RecruitmentTemplateRecord = {
  id: string;
  name: string;
  keywords: string;
  roleType: string | null;
  city: string | null;
  country: string | null;
  experienceRange: string | null;
  salaryRange: string | null;
  language: string | null;
  remoteMode: string | null;
  sourceIdsJson: string;
  enabled: boolean;
  candidateLinks?: Array<{ candidateId: string }>;
  createdAt: Date;
  updatedAt: Date;
};

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function serializeRecruitmentTemplate(template: RecruitmentTemplateRecord) {
  return {
    id: template.id,
    name: template.name,
    keywords: template.keywords,
    roleType: template.roleType,
    city: template.city,
    country: template.country,
    experienceRange: template.experienceRange,
    salaryRange: template.salaryRange,
    language: template.language,
    remoteMode: template.remoteMode,
    sourceIds: parseJsonArray(template.sourceIdsJson),
    candidateIds: template.candidateLinks?.map((link) => link.candidateId) || [],
    enabled: template.enabled,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

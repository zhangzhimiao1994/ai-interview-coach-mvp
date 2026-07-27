import { buildRecruitmentDedupeKey, canonicalizeJobUrl, normalizeRecruitmentText } from "@/lib/recruitment/normalization";
import type { NormalizedRecruitmentPostingInput } from "@/lib/recruitment/types";

export type ManualRecruitmentPostingInput = {
  title: string;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  description: string;
  requirementsText?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
};

export type RecruitmentPostingRecord = {
  id: string;
  provider: string;
  sourceType: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  description: string;
  requirementsJson: string;
  sourceUrl: string | null;
  externalJobId?: string | null;
  publishedAt?: Date | null;
  dedupeKey?: string;
  status?: string;
  editedNotes: string | null;
  manualImport?: boolean;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export function splitRequirementsText(value?: string | null) {
  return (value || "")
    .split(/\r?\n/)
    .map((line) => normalizeRecruitmentText(line))
    .filter(Boolean);
}

function optionalText(value?: string | null) {
  const normalized = normalizeRecruitmentText(value || "");
  return normalized || null;
}

export function createManualRecruitmentPostingInput(input: ManualRecruitmentPostingInput) {
  const title = normalizeRecruitmentText(input.title);
  const description = normalizeRecruitmentText(input.description);
  const sourceUrl = input.sourceUrl?.trim() ? canonicalizeJobUrl(input.sourceUrl) : null;
  const company = optionalText(input.company);

  return {
    provider: "manual",
    sourceType: "MANUAL" as const,
    title,
    company,
    location: optionalText(input.location),
    salary: optionalText(input.salary),
    description,
    requirements: splitRequirementsText(input.requirementsText),
    sourceUrl,
    externalJobId: null,
    publishedAt: null,
    rawJson: undefined,
    editedNotes: optionalText(input.notes),
    manualImport: true,
    dedupeKey: buildRecruitmentDedupeKey({
      provider: "manual",
      sourceUrl,
      title,
      company,
      description
    })
  };
}

export function normalizeConnectorPostingInput(input: NormalizedRecruitmentPostingInput) {
  const title = normalizeRecruitmentText(input.title);
  const description = normalizeRecruitmentText(input.description);
  const company = optionalText(input.company);
  const sourceUrl = input.sourceUrl?.trim() ? canonicalizeJobUrl(input.sourceUrl) : null;

  return {
    provider: normalizeRecruitmentText(input.provider).toLowerCase(),
    sourceType: input.sourceType,
    title,
    company,
    location: optionalText(input.location),
    salary: optionalText(input.salary),
    description,
    requirements: input.requirements?.map((line) => normalizeRecruitmentText(line)).filter(Boolean) || [],
    sourceUrl,
    externalJobId: optionalText(input.externalJobId),
    publishedAt: input.publishedAt || null,
    rawJson: input.rawJson,
    dedupeKey: buildRecruitmentDedupeKey({
      provider: input.provider,
      externalJobId: input.externalJobId,
      sourceUrl,
      title,
      company,
      description
    })
  };
}

function parseRequirements(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export function serializeRecruitmentPosting(posting: RecruitmentPostingRecord) {
  return {
    id: posting.id,
    provider: posting.provider,
    sourceType: posting.sourceType,
    title: posting.title,
    company: posting.company,
    location: posting.location,
    salary: posting.salary,
    description: posting.description,
    requirements: parseRequirements(posting.requirementsJson),
    sourceUrl: posting.sourceUrl,
    externalJobId: posting.externalJobId || null,
    publishedAt: iso(posting.publishedAt || null),
    status: posting.status || "ACTIVE",
    editedNotes: posting.editedNotes,
    manualImport: Boolean(posting.manualImport),
    firstSeenAt: iso(posting.firstSeenAt || null),
    lastSeenAt: iso(posting.lastSeenAt || null),
    createdAt: iso(posting.createdAt || null),
    updatedAt: iso(posting.updatedAt || null)
  };
}

export function toTrainingTaskJobSnapshot(posting: Pick<
  RecruitmentPostingRecord,
  "id" | "title" | "company" | "sourceUrl" | "description" | "requirementsJson" | "editedNotes"
>) {
  const requirements = parseRequirements(posting.requirementsJson);
  const requirementsText = requirements.length ? `\n\nRequirements:\n${requirements.map((item) => `- ${item}`).join("\n")}` : "";

  return {
    jobPostingId: posting.id,
    targetRole: posting.title,
    targetCompany: posting.company || "",
    jobSourceUrl: posting.sourceUrl || undefined,
    jobDescription: `${posting.description}${requirementsText}`,
    jobManualNotes: posting.editedNotes || undefined
  };
}

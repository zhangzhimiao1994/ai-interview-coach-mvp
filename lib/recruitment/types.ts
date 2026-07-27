export const recruitmentSourceTypes = ["AGGREGATED_API", "PUBLIC_SOURCE", "AUTHORIZED_BROWSER", "MANUAL"] as const;
export type RecruitmentSourceType = typeof recruitmentSourceTypes[number];

export const recruitmentRunStatuses = [
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "PARTIAL",
  "AUTH_REQUIRED",
  "RATE_LIMITED",
  "SOURCE_UNAVAILABLE",
  "PARSER_CHANGED",
  "FAILED",
  "PAUSED"
] as const;
export type RecruitmentRunStatus = typeof recruitmentRunStatuses[number];

export type NormalizedRecruitmentPostingInput = {
  provider: string;
  sourceType: RecruitmentSourceType;
  title: string;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  description: string;
  requirements?: string[];
  sourceUrl?: string | null;
  externalJobId?: string | null;
  publishedAt?: Date | null;
  rawJson?: unknown;
};

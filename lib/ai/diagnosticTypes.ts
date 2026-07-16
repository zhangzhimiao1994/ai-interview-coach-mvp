import type { AiCapability } from "@/lib/domain/aiServiceConstants";

export const aiDiagnosticStatuses = [
  "AVAILABLE",
  "CONFIG_VALID",
  "CONFIGURED_NOT_ADAPTED",
  "NOT_SELECTED",
  "MISCONFIGURED",
  "UNREACHABLE"
] as const;

export const textDiagnosticCapabilities = [
  "INTERVIEW_DIALOGUE",
  "INTERVIEW_OUTLINE",
  "INTERVIEW_FOLLOW_UP",
  "REPORT_ANALYSIS",
  "COMPANY_RESEARCH",
  "SAFETY_REVIEW"
] as const satisfies readonly AiCapability[];

export type AiDiagnosticStatus = (typeof aiDiagnosticStatuses)[number];
export type AiDiagnosticCheckMode = "CONFIG" | "LIVE";

export type AiDiagnosticResult = {
  capability: AiCapability;
  providerName: string | null;
  modelDisplayName: string | null;
  modelName: string | null;
  checkMode: AiDiagnosticCheckMode;
  status: AiDiagnosticStatus;
  code: string;
  latencyMs: number;
  message: string;
  checkedAt: string;
};

export function isTextDiagnosticCapability(
  capability: AiCapability
): capability is (typeof textDiagnosticCapabilities)[number] {
  return textDiagnosticCapabilities.some((item) => item === capability);
}

import { z } from "zod";
import { trainingStageTypes } from "@/lib/domain/stages";
import type { CoachingReportResult } from "./types";

export type SerializedCoachingReportForStorage = {
  overallScore: number;
  subScores: string;
  perQuestionFeedback: string;
  expressionAnalysis: string;
  answerQualityAnalysis: string;
  strategySuggestions: string;
  weakTags: string;
  nextTrainingPlan: string;
  candidateSummary: string;
  detailsJson?: string;
};

export type StoredCoachingReportRecord = Omit<SerializedCoachingReportForStorage, "detailsJson"> & {
  detailsJson?: string | null;
};

export type SafeDeserializeStoredCoachingReportResult =
  | { ok: true; report: CoachingReportResult }
  | { ok: false; error: string };

const stringArraySchema = z.array(z.string());
const trainingStageTypeSchema = z.enum(trainingStageTypes);

const reportDetailsSchema = z
  .object({
    readinessVerdict: z
      .object({
        level: z.string(),
        summary: z.string(),
        priorityRisk: z.string()
      })
      .strict(),
    scoreExplanations: z.record(z.string()),
    competencyAssessment: z.array(
      z
        .object({
          competency: z.string(),
          evidence: z.string(),
          risk: z.string(),
          coachingAction: z.string()
        })
        .strict()
    ),
    priorityActions: z.array(
      z
        .object({
          title: z.string(),
          reason: z.string(),
          drill: z.string()
        })
        .strict()
    ),
    weeklyPlan: z.array(
      z
        .object({
          day: z.number().int().positive(),
          stage: trainingStageTypeSchema,
          drill: z.string(),
          successCriterion: z.string()
        })
        .strict()
    ),
    behaviorEvidence: z
      .array(
        z
          .object({
            questionId: z.string().optional(),
            observations: stringArraySchema,
            risks: stringArraySchema,
            coachingTips: stringArraySchema
          })
          .strict()
      )
      .optional()
  })
  .strict();

const coachingReportResultSchema: z.ZodType<CoachingReportResult> = z
  .object({
    overallScore: z.number().finite(),
    subScores: z
      .object({
        expressionStructure: z.number().finite(),
        contentRelevance: z.number().finite(),
        confidence: z.number().finite(),
        pressureHandling: z.number().finite(),
        roleFit: z.number().finite()
      })
      .strict(),
    perQuestionFeedback: z.array(
      z
        .object({
          questionId: z.string(),
          stage: trainingStageTypeSchema,
          score: z.number().finite(),
          strengths: stringArraySchema,
          improvements: stringArraySchema,
          answerEvidence: stringArraySchema.optional(),
          improvementAction: z.string().optional()
        })
        .strict()
    ),
    expressionAnalysis: z
      .object({
        summary: z.string(),
        strongPoints: stringArraySchema,
        improvementPoints: stringArraySchema
      })
      .strict(),
    answerQualityAnalysis: z
      .object({
        summary: z.string(),
        evidence: stringArraySchema,
        gaps: stringArraySchema
      })
      .strict(),
    strategySuggestions: stringArraySchema,
    weakTags: stringArraySchema,
    nextTrainingPlan: z
      .object({
        focus: z.string(),
        drills: stringArraySchema,
        recommendedStages: z.array(trainingStageTypeSchema)
      })
      .strict(),
    candidateSummary: z.string(),
    details: reportDetailsSchema.optional()
  })
  .strict();

export function serializeCoachingReportForStorage(report: CoachingReportResult): SerializedCoachingReportForStorage {
  const serialized: SerializedCoachingReportForStorage = {
    overallScore: report.overallScore,
    subScores: JSON.stringify(report.subScores),
    perQuestionFeedback: JSON.stringify(report.perQuestionFeedback),
    expressionAnalysis: JSON.stringify(report.expressionAnalysis),
    answerQualityAnalysis: JSON.stringify(report.answerQualityAnalysis),
    strategySuggestions: JSON.stringify(report.strategySuggestions),
    weakTags: JSON.stringify(report.weakTags),
    nextTrainingPlan: JSON.stringify(report.nextTrainingPlan),
    candidateSummary: report.candidateSummary
  };

  if (report.details) {
    serialized.detailsJson = JSON.stringify(report.details);
  }

  return serialized;
}

function parseStoredJsonField(field: string, value: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, error: `${field} contains malformed JSON.` };
  }
}

export function safeDeserializeStoredCoachingReport(
  record: StoredCoachingReportRecord
): SafeDeserializeStoredCoachingReportResult {
  const jsonFields = {
    subScores: record.subScores,
    perQuestionFeedback: record.perQuestionFeedback,
    expressionAnalysis: record.expressionAnalysis,
    answerQualityAnalysis: record.answerQualityAnalysis,
    strategySuggestions: record.strategySuggestions,
    weakTags: record.weakTags,
    nextTrainingPlan: record.nextTrainingPlan
  };
  const parsedFields: Record<keyof typeof jsonFields, unknown> = {
    subScores: undefined,
    perQuestionFeedback: undefined,
    expressionAnalysis: undefined,
    answerQualityAnalysis: undefined,
    strategySuggestions: undefined,
    weakTags: undefined,
    nextTrainingPlan: undefined
  };

  for (const [field, value] of Object.entries(jsonFields)) {
    const parsed = parseStoredJsonField(field, value);

    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    parsedFields[field as keyof typeof jsonFields] = parsed.value;
  }

  let details: unknown;

  if (record.detailsJson?.trim() && record.detailsJson.trim() !== "{}") {
    const parsedDetails = parseStoredJsonField("detailsJson", record.detailsJson);

    if (!parsedDetails.ok) {
      return { ok: false, error: parsedDetails.error };
    }

    details = parsedDetails.value;
  }

  const result = coachingReportResultSchema.safeParse({
    overallScore: record.overallScore,
    ...parsedFields,
    candidateSummary: record.candidateSummary,
    details
  });

  if (!result.success) {
    const invalidPaths = result.error.issues
      .map((issue) => issue.path.join(".") || "report")
      .join(", ");

    return { ok: false, error: `Stored coaching report has invalid shape: ${invalidPaths}.` };
  }

  return { ok: true, report: result.data };
}

export function deserializeStoredCoachingReport(record: StoredCoachingReportRecord): CoachingReportResult {
  const result = safeDeserializeStoredCoachingReport(record);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.report;
}

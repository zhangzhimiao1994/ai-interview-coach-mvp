import { z } from "zod";
import type {
  AiProvider,
  CoachingReportInput,
  CoachingReportResult,
  FollowUpCoachingInput,
  FollowUpCoachingResult,
  TrainingOutline,
  TrainingOutlineRequest
} from "./types";

type FetchLike = typeof fetch;

export type OpenAiCompatibleProviderConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
};

const trainingStageSchema = z.enum([
  "WARM_UP",
  "FORMAL_INTERVIEW",
  "PRESSURE_FOLLOW_UP",
  "EXPERIENCE_DEEP_DIVE",
  "CASE_ANALYSIS",
  "ENGLISH_INTERVIEW",
  "AI_REVIEW",
  "FOLLOW_UP_PLAN"
]);

const trainingOutlineSchema: z.ZodType<TrainingOutline> = z.object({
  title: z.string(),
  targetRole: z.string(),
  targetCompany: z.string().optional(),
  stages: z.array(trainingStageSchema),
  estimatedMinutes: z.number().int().positive(),
  questions: z.array(
    z.object({
      id: z.string(),
      stage: trainingStageSchema,
      prompt: z.string(),
      expectedFocus: z.array(z.string()),
      followUps: z.array(z.string()),
      difficulty: z.enum(["LOW", "MEDIUM", "HIGH"]),
      timeLimitSeconds: z.number().int().positive()
    })
  )
});

const coachingReportSchema: z.ZodType<CoachingReportResult> = z.object({
  overallScore: z.number().int().min(0).max(100),
  subScores: z.object({
    expressionStructure: z.number().int().min(0).max(100),
    contentRelevance: z.number().int().min(0).max(100),
    confidence: z.number().int().min(0).max(100),
    pressureHandling: z.number().int().min(0).max(100),
    roleFit: z.number().int().min(0).max(100)
  }),
  perQuestionFeedback: z.array(
    z.object({
      questionId: z.string(),
      stage: trainingStageSchema,
      score: z.number().int().min(0).max(100),
      strengths: z.array(z.string()),
      improvements: z.array(z.string()),
      answerEvidence: z.array(z.string()).optional(),
      improvementAction: z.string().optional()
    })
  ),
  expressionAnalysis: z.object({
    summary: z.string(),
    strongPoints: z.array(z.string()),
    improvementPoints: z.array(z.string())
  }),
  answerQualityAnalysis: z.object({
    summary: z.string(),
    evidence: z.array(z.string()),
    gaps: z.array(z.string())
  }),
  strategySuggestions: z.array(z.string()),
  weakTags: z.array(z.string()),
  nextTrainingPlan: z.object({
    focus: z.string(),
    drills: z.array(z.string()),
    recommendedStages: z.array(trainingStageSchema)
  }),
  candidateSummary: z.string(),
  details: z
    .object({
      readinessVerdict: z.object({
        level: z.string(),
        summary: z.string(),
        priorityRisk: z.string()
      }),
      scoreExplanations: z.record(z.string()),
      competencyAssessment: z.array(
        z.object({
          competency: z.string(),
          evidence: z.string(),
          risk: z.string(),
          coachingAction: z.string()
        })
      ),
      priorityActions: z.array(
        z.object({
          title: z.string(),
          reason: z.string(),
          drill: z.string()
        })
      ),
      weeklyPlan: z.array(
        z.object({
          day: z.number().int().positive(),
          stage: trainingStageSchema,
          drill: z.string(),
          successCriterion: z.string()
        })
      )
    })
    .optional()
});

const followUpCoachingSchema: z.ZodType<FollowUpCoachingResult> = z.object({
  instantFeedback: z.string(),
  followUpQuestion: z.string(),
  suggestedAnswerStructure: z.array(z.string()),
  riskTags: z.array(z.string())
});

function chatCompletionsEndpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

async function requestJson(
  config: OpenAiCompatibleProviderConfig,
  messages: Array<{ role: "system" | "user"; content: string }>
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const fetchImpl = config.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(chatCompletionsEndpoint(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.modelName,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${body}`.trim());
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI-compatible response did not include message content.");
    }

    return JSON.parse(content) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleProviderConfig): AiProvider {
  return {
    async generateTrainingOutline(request: TrainingOutlineRequest) {
      const result = await requestJson(config, [
        {
          role: "system",
          content:
            "You are an interview training system. Return strict JSON only, with no Markdown. Use the requested language for user-facing text."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "generateTrainingOutline",
            capability: "INTERVIEW_OUTLINE",
            request,
            requiredShape: {
              title: "string",
              targetRole: "string",
              targetCompany: "string optional",
              stages: "TrainingStageType[]",
              estimatedMinutes: "positive integer",
              questions: [
                {
                  id: "string",
                  stage: "TrainingStageType",
                  prompt: "string",
                  expectedFocus: "string[]",
                  followUps: "string[]",
                  difficulty: "LOW | MEDIUM | HIGH",
                  timeLimitSeconds: "positive integer"
                }
              ]
            }
          })
        }
      ]);

      return trainingOutlineSchema.parse(result);
    },
    async generateFollowUpCoaching(input: FollowUpCoachingInput) {
      const result = await requestJson(config, [
        {
          role: "system",
          content:
            "You are a live AI interviewer and interview coach. Return strict JSON only, with no Markdown. Give concise, actionable coaching and one natural follow-up question in the candidate's language."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "generateFollowUpCoaching",
            capability: "INTERVIEW_FOLLOW_UP",
            input,
            requiredShape: {
              instantFeedback: "short coaching feedback string",
              followUpQuestion: "one next interviewer question",
              suggestedAnswerStructure: "string[]",
              riskTags: "string[]"
            }
          })
        }
      ]);

      return followUpCoachingSchema.parse(result);
    },
    async generateCoachingReport(input: CoachingReportInput) {
      const result = await requestJson(config, [
        {
          role: "system",
          content:
            "You are an interview coaching analyst for a paid job-seeker interview service. Return strict JSON only, with no Markdown. Use Chinese for user-facing text unless the candidate input is explicitly English. Ground every judgment in the provided answers. Do not invent employers, metrics, or experiences that are not present; when evidence is missing, say what evidence is missing and what drill should collect it."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "generateCoachingReport",
            capability: "REPORT_ANALYSIS",
            input,
            requiredShape: {
              overallScore: "0-100 integer",
              subScores: {
                expressionStructure: "0-100 integer",
                contentRelevance: "0-100 integer",
                confidence: "0-100 integer",
                pressureHandling: "0-100 integer",
                roleFit: "0-100 integer"
              },
              perQuestionFeedback: [
                {
                  questionId: "string",
                  stage: "TrainingStageType",
                  score: "0-100 integer",
                  strengths: "string[]",
                  improvements: "string[]",
                  answerEvidence: "string[]; direct paraphrased evidence from the answer, or missing-evidence notes",
                  improvementAction: "one concrete rewrite or practice action"
                }
              ],
              expressionAnalysis: "object",
              answerQualityAnalysis: "object",
              strategySuggestions: "string[]",
              weakTags: "string[]",
              nextTrainingPlan: "object",
              candidateSummary: "string",
              details: {
                readinessVerdict: {
                  level: "READY | READY_WITH_RISKS | NEEDS_PRACTICE",
                  summary: "clear interview-readiness conclusion",
                  priorityRisk: "single most important risk before the real interview"
                },
                scoreExplanations: {
                  expressionStructure: "why this score was given",
                  contentRelevance: "why this score was given",
                  confidence: "why this score was given",
                  pressureHandling: "why this score was given",
                  roleFit: "why this score was given"
                },
                competencyAssessment: [
                  {
                    competency: "competency name",
                    evidence: "evidence from answers",
                    risk: "interview risk",
                    coachingAction: "service follow-up action"
                  }
                ],
                priorityActions: [
                  {
                    title: "action title",
                    reason: "why this action matters",
                    drill: "specific drill"
                  }
                ],
                weeklyPlan: [
                  {
                    day: "1-7 integer",
                    stage: "TrainingStageType",
                    drill: "daily drill",
                    successCriterion: "observable pass criterion"
                  }
                ]
              }
            }
          })
        }
      ]);

      return coachingReportSchema.parse(result);
    }
  };
}

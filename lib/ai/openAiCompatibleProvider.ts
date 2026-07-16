import { z } from "zod";
import { summarizeBehaviorSignals } from "@/lib/domain/behaviorSignals";
import { AiProviderError, AiStructuredOutputError } from "./errors";
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
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  fetchImpl?: FetchLike;
};

export type OpenAiCompatibleProbeResult =
  | {
      ok: true;
      code: "LIVE_CHECK_SUCCEEDED";
      message: string;
    }
  | {
      ok: false;
      code:
        | "AUTHENTICATION_FAILED"
        | "MODEL_NOT_FOUND"
        | "RATE_LIMITED"
        | "UPSTREAM_UNAVAILABLE"
        | "TIMEOUT"
        | "NETWORK_ERROR"
        | "INVALID_RESPONSE"
        | "UPSTREAM_REQUEST_FAILED";
      message: string;
    };

class AiProviderHttpError extends AiProviderError {
  constructor(
    readonly status: number,
    readonly responseBody: string
  ) {
    super(`OpenAI-compatible request failed: ${status} ${responseBody}`.trim());
    this.name = "AiProviderHttpError";
  }
}

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
      ),
      behaviorEvidence: z
        .array(
          z.object({
            questionId: z.string().optional(),
            observations: z.array(z.string()),
            risks: z.array(z.string()),
            coachingTips: z.array(z.string())
          })
        )
        .optional()
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

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const embedded = objectStart >= 0 && objectEnd > objectStart
    ? trimmed.slice(objectStart, objectEnd + 1)
    : undefined;
  const candidates = [trimmed, fenced, embedded].filter(
    (candidate, index, values): candidate is string =>
      Boolean(candidate) && values.indexOf(candidate) === index
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next safe extraction strategy.
    }
  }

  throw new AiStructuredOutputError("AI response was not valid structured JSON.");
}

function parseRequiredShape<T>(schema: z.ZodType<T>, value: unknown, capability: string) {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  const issueSummary = parsed.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
    .join("; ");

  throw new AiStructuredOutputError(
    `${capability} response did not match the required structure: ${issueSummary}`
  );
}

async function executeRequest(
  config: OpenAiCompatibleProviderConfig,
  messages: Array<{ role: "system" | "user"; content: string }>,
  useJsonMode: boolean
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
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AiProviderHttpError(response.status, body.slice(0, 1_000));
    }

    let payload: { choices?: Array<{ message?: { content?: string } }> };

    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      throw new AiProviderError("OpenAI-compatible response body was not JSON.", { cause: error });
    }

    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new AiProviderError("OpenAI-compatible response did not include message content.");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function safeProbeFailure(error: unknown): OpenAiCompatibleProbeResult {
  if (error instanceof AiProviderHttpError) {
    if (error.status === 401 || error.status === 403) {
      return {
        ok: false,
        code: "AUTHENTICATION_FAILED",
        message: "认证失败，请检查服务商凭据。"
      };
    }

    if (error.status === 404) {
      return {
        ok: false,
        code: "MODEL_NOT_FOUND",
        message: "未找到配置的模型或请求地址。"
      };
    }

    if (error.status === 408) {
      return {
        ok: false,
        code: "TIMEOUT",
        message: "真实连通测试超时。"
      };
    }

    if (error.status === 429) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "服务商暂时限制了请求，请稍后重试。"
      };
    }

    if (error.status >= 500) {
      return {
        ok: false,
        code: "UPSTREAM_UNAVAILABLE",
        message: "服务商当前不可用，请稍后重试。"
      };
    }

    return {
      ok: false,
      code: "UPSTREAM_REQUEST_FAILED",
      message: "服务商拒绝了诊断请求。"
    };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return {
      ok: false,
      code: "TIMEOUT",
      message: "真实连通测试超时。"
    };
  }

  if (error instanceof TypeError) {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: "无法连接服务商，请检查网络和请求地址。"
    };
  }

  if (error instanceof AiProviderError) {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: "服务商返回了无法识别的诊断响应。"
    };
  }

  return {
    ok: false,
    code: "UPSTREAM_REQUEST_FAILED",
    message: "真实连通测试失败。"
  };
}

export async function probeOpenAiCompatibleModel(
  config: OpenAiCompatibleProviderConfig
): Promise<OpenAiCompatibleProbeResult> {
  try {
    await executeRequest(
      { ...config, temperature: 0, maxTokens: 1 },
      [
        { role: "system", content: "Connection diagnostic. Reply with OK." },
        { role: "user", content: "OK" }
      ],
      false
    );

    return {
      ok: true,
      code: "LIVE_CHECK_SUCCEEDED",
      message: "真实连通测试通过。"
    };
  } catch (error) {
    return safeProbeFailure(error);
  }
}

function isJsonModeUnsupported(error: unknown) {
  return (
    error instanceof AiProviderHttpError &&
    (error.status === 400 || error.status === 422) &&
    /response_format|json_object|json mode/i.test(error.responseBody)
  );
}

function isRetryable(error: unknown) {
  if (error instanceof AiProviderHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

async function requestJson(
  config: OpenAiCompatibleProviderConfig,
  messages: Array<{ role: "system" | "user"; content: string }>
) {
  const maxRetries = Math.max(0, config.maxRetries ?? 2);
  const retryBaseDelayMs = Math.max(0, config.retryBaseDelayMs ?? 250);
  const wait = config.sleepImpl ?? sleep;
  let retryCount = 0;
  let useJsonMode = true;

  while (true) {
    try {
      return parseJsonContent(await executeRequest(config, messages, useJsonMode));
    } catch (error) {
      if (useJsonMode && isJsonModeUnsupported(error)) {
        useJsonMode = false;
        continue;
      }

      if (retryCount < maxRetries && isRetryable(error)) {
        const delay = retryBaseDelayMs * 2 ** retryCount;
        retryCount += 1;
        await wait(delay);
        continue;
      }

      throw error;
    }
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

      return parseRequiredShape(trainingOutlineSchema, result, "Interview outline");
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

      return parseRequiredShape(followUpCoachingSchema, result, "Interview follow-up");
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
                ],
                behaviorEvidence: [
                  {
                    questionId: "string optional",
                    observations: "observable behavior signals only, such as duration, long pauses, microphone/camera state",
                    risks: "interview impact, not psychological diagnosis",
                    coachingTips: "specific behavior practice tips"
                  }
                ]
              }
            }
          })
        }
      ]);

      const parsed = parseRequiredShape(coachingReportSchema, result, "Coaching report");
      const fallbackEvidence = input.turns
        .filter((turn) => turn.behaviorSignals)
        .map((turn) => ({
          questionId: turn.questionId,
          ...summarizeBehaviorSignals(turn.behaviorSignals!)
        }));

      return {
        ...parsed,
        details: parsed.details
          ? {
              ...parsed.details,
              behaviorEvidence: parsed.details.behaviorEvidence?.length
                ? parsed.details.behaviorEvidence
                : fallbackEvidence
            }
          : parsed.details
      };
    }
  };
}

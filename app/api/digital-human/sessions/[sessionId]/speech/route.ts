import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  parseSavedOutline,
  resolveSessionQuestion
} from "@/lib/domain/trainingQuestions";
import { resolveMediaModel, type ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import { createAlibabaTtsProvider } from "@/lib/media/providers/alibabaTts";
import type {
  SpeechPcmStreamResult,
  SpeechSynthesisInput
} from "@/lib/media/types";
import { consumeRateLimit as consumeRequestRateLimit } from "@/lib/security/requestGuards";

const speechSchema = z
  .object({
    questionId: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(600),
    speed: z.number().finite().min(0.5).max(2).default(1)
  })
  .strict();

type RouteContext = { params: Promise<{ sessionId: string }> };
type SpeechSession = {
  id: string;
  status: string;
  trainingSessionId: string;
  trainingSession: {
    id: string;
    status: string;
    outlineJson: string | null;
    turns: Array<{
      questionId: string | null;
      stage: string;
      feedback: string | null;
    }>;
  };
};

type SpeechCallLog = {
  sessionId: string;
  capability: "TEXT_TO_SPEECH";
  provider: string;
  latencyMs: number;
  costEstimate: number;
  success: boolean;
  failureReason: string | null;
  fallbackProvider: string | null;
};

type SpeechDependencies = {
  findSession: (id: string) => Promise<SpeechSession | null>;
  consumeRateLimit: (
    key: string,
    limit: number,
    windowMs: number
  ) => { allowed: boolean };
  markSpeaking: (id: string) => Promise<boolean>;
  markReady: (id: string) => Promise<void>;
  resolveModel: () => Promise<ResolvedMediaModel>;
  streamPcm?: (
    input: SpeechSynthesisInput
  ) => Promise<SpeechPcmStreamResult>;
  logCall: (data: SpeechCallLog) => Promise<unknown>;
  now: () => number;
};

function defaultDependencies(): Omit<SpeechDependencies, "streamPcm"> {
  return {
    findSession: (id) =>
      prisma.digitalHumanSession.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          trainingSessionId: true,
          trainingSession: {
            select: {
              id: true,
              status: true,
              outlineJson: true,
              turns: {
                orderBy: { createdAt: "asc" },
                select: { questionId: true, stage: true, feedback: true }
              }
            }
          }
        }
      }),
    consumeRateLimit: consumeRequestRateLimit,
    async markSpeaking(id) {
      const update = await prisma.digitalHumanSession.updateMany({
        where: { id, status: "READY" },
        data: { status: "SPEAKING", lastActivityAt: new Date() }
      });
      return update.count === 1;
    },
    async markReady(id) {
      await prisma.digitalHumanSession.updateMany({
        where: { id, status: "SPEAKING" },
        data: { status: "READY", lastActivityAt: new Date() }
      });
    },
    resolveModel: () => resolveMediaModel("TEXT_TO_SPEECH"),
    logCall: (data) => prisma.aiCallLog.create({ data }),
    now: Date.now
  };
}

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function safeFailureCode(error: unknown) {
  const code =
    error instanceof MediaProviderError || error instanceof MediaConfigurationError
      ? error.code
      : "TTS_UNAVAILABLE";
  return /^[A-Z0-9_.-]{1,100}$/.test(code) ? code : "TTS_UNAVAILABLE";
}

async function safeFinalize(
  deps: SpeechDependencies,
  digitalHumanSessionId: string,
  log: SpeechCallLog
) {
  await Promise.allSettled([
    deps.markReady(digitalHumanSessionId),
    deps.logCall(log)
  ]);
}

export function createDigitalHumanSpeechStreamHandler(
  overrides: Partial<SpeechDependencies> = {}
) {
  const deps: SpeechDependencies = { ...defaultDependencies(), ...overrides };

  return async function handleSpeech(request: Request, context: RouteContext) {
    let input: z.infer<typeof speechSchema>;
    try {
      input = speechSchema.parse(await request.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return noStoreJson(
          { error: "Validation failed", issues: error.issues },
          400
        );
      }
      return noStoreJson({ error: "Invalid JSON" }, 400);
    }

    const digitalHumanSessionId = (await context.params).sessionId.trim();
    if (!digitalHumanSessionId) {
      return noStoreJson({ error: "Session is required" }, 400);
    }
    const rateLimit = deps.consumeRateLimit(
      `POST:/api/digital-human/sessions/${digitalHumanSessionId}/speech`,
      30,
      60_000
    );
    if (!rateLimit.allowed) {
      return noStoreJson({ error: "Too many requests" }, 429);
    }

    let session: SpeechSession | null;
    try {
      session = await deps.findSession(digitalHumanSessionId);
    } catch {
      return noStoreJson({ error: "Internal server error" }, 500);
    }
    if (!session) return noStoreJson({ error: "Session not found" }, 404);
    if (session.status !== "READY") {
      return noStoreJson({ error: "Digital human session is not ready" }, 409);
    }
    if (session.trainingSession.status !== "IN_PROGRESS") {
      return noStoreJson({ error: "Training session is not active" }, 409);
    }

    const outline = parseSavedOutline(session.trainingSession.outlineJson);
    if (!outline) {
      return noStoreJson({ error: "Session outline is unavailable" }, 409);
    }
    const question = resolveSessionQuestion(
      outline,
      input.questionId,
      session.trainingSession.turns
    );
    if (!question || question.prompt !== input.text) {
      return noStoreJson({ error: "Unknown session question" }, 400);
    }
    let claimed: boolean;
    try {
      claimed = await deps.markSpeaking(digitalHumanSessionId);
    } catch {
      return noStoreJson({ error: "Internal server error" }, 500);
    }
    if (!claimed) {
      return noStoreJson({ error: "Digital human session is busy" }, 409);
    }

    const startedAt = deps.now();
    let model: ResolvedMediaModel | null = null;
    let result: SpeechPcmStreamResult;
    let iterator: AsyncIterator<Uint8Array>;
    try {
      model = await deps.resolveModel();
      const speechInput: SpeechSynthesisInput = {
        text: input.text,
        speed: input.speed
      };
      result = deps.streamPcm
        ? await deps.streamPcm(speechInput)
        : await createAlibabaTtsProvider(model).streamPcm(speechInput);
      iterator = result.chunks[Symbol.asyncIterator]();
    } catch (error) {
      await safeFinalize(deps, digitalHumanSessionId, {
        sessionId: session.trainingSessionId,
        capability: "TEXT_TO_SPEECH",
        provider: model?.providerName ?? "unconfigured",
        latencyMs: Math.max(0, deps.now() - startedAt),
        costEstimate: 0,
        success: false,
        failureReason: safeFailureCode(error),
        fallbackProvider: "browser-speechSynthesis"
      });
      return noStoreJson(
        { mode: "BROWSER_TTS_FALLBACK", reasonCode: "TTS_UNAVAILABLE" },
        503
      );
    }

    let finalized = false;
    const finalize = async (success: boolean, failureReason: string | null) => {
      if (finalized) return;
      finalized = true;
      await safeFinalize(deps, digitalHumanSessionId, {
        sessionId: session.trainingSessionId,
        capability: "TEXT_TO_SPEECH",
        provider: result.provider,
        latencyMs: Math.max(0, deps.now() - startedAt),
        costEstimate: 0,
        success,
        failureReason,
        fallbackProvider: success ? null : "browser-speechSynthesis"
      });
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            await finalize(true, null);
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          await iterator.return?.().catch(() => undefined);
          await finalize(false, safeFailureCode(error));
          controller.error(new Error("TTS stream failed"));
        }
      },
      async cancel() {
        await iterator.return?.().catch(() => undefined);
        await finalize(false, "TTS_CANCELLED");
      }
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "audio/pcm",
        "Cache-Control": "no-store",
        "X-Audio-Format": "pcm_s16le",
        "X-Audio-Sample-Rate": "48000",
        "X-Audio-Channels": "1"
      }
    });
  };
}

export const POST = createDigitalHumanSpeechStreamHandler();

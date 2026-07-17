import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { consumeRateLimit as consumeRequestRateLimit } from "@/lib/security/requestGuards";
import {
  resolveMediaModel,
  type ResolvedMediaModel
} from "@/lib/media/config";
import {
  MediaConfigurationError,
  MediaProviderError
} from "@/lib/media/errors";
import { createAlibabaTtsProvider } from "@/lib/media/providers/alibabaTts";
import type {
  SpeechSynthesisInput,
  SpeechSynthesisResult
} from "@/lib/media/types";

const speechRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(600),
    voice: z.string().trim().min(1).max(100).optional(),
    language: z.string().trim().min(2).max(20).default("zh-CN"),
    speed: z.number().finite().min(0.5).max(2).default(1),
    expression: z.string().trim().min(1).max(100).optional(),
    instructions: z.string().trim().min(1).max(1600).optional(),
    sessionId: z.string().trim().min(1).max(200),
    questionId: z.string().trim().min(1).max(200).optional()
  })
  .strict();

type SpeechCallLog = {
  sessionId?: string;
  capability: "TEXT_TO_SPEECH";
  provider: string;
  latencyMs: number;
  costEstimate: number;
  success: boolean;
  failureReason: string | null;
  fallbackProvider: string | null;
};

type DigitalHumanSpeechDependencies = {
  findSession: (
    sessionId: string
  ) => Promise<{ id: string; status: string } | null>;
  consumeRateLimit: (
    key: string,
    limit: number,
    windowMs: number
  ) => { allowed: boolean; remaining: number; resetAt: number };
  resolveModel: () => Promise<ResolvedMediaModel>;
  synthesize: (
    model: ResolvedMediaModel,
    input: SpeechSynthesisInput
  ) => Promise<SpeechSynthesisResult>;
  logCall: (data: SpeechCallLog) => Promise<unknown>;
  now: () => number;
};

function defaultDependencies(): DigitalHumanSpeechDependencies {
  return {
    findSession: (sessionId) =>
      prisma.trainingSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true }
      }),
    consumeRateLimit: consumeRequestRateLimit,
    resolveModel: () => resolveMediaModel("TEXT_TO_SPEECH"),
    synthesize: (model, input) =>
      createAlibabaTtsProvider(model).synthesize(input),
    logCall: (data) => prisma.aiCallLog.create({ data }),
    now: Date.now
  };
}

function noStoreJson(body: unknown, status = 200) {
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

function configuredVoice(model: ResolvedMediaModel | null, requested?: string) {
  if (requested) {
    return requested;
  }

  const stored = model?.modelSettings.voice;
  return typeof stored === "string" && stored.trim()
    ? stored.trim()
    : "browser-default";
}

export function createDigitalHumanSpeechHandler(
  overrides: Partial<DigitalHumanSpeechDependencies> = {}
) {
  const deps = { ...defaultDependencies(), ...overrides };

  return async function handleDigitalHumanSpeech(request: Request) {
    let input: z.infer<typeof speechRequestSchema>;

    try {
      input = speechRequestSchema.parse(await request.json());
    } catch (error) {
      return postErrorResponse(error);
    }

    const rateLimit = deps.consumeRateLimit(
      `POST:/api/digital-human/speech:${input.sessionId}`,
      30,
      60_000
    );

    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: "Too many requests",
          message: "请稍后再生成面试官语音。"
        },
        429
      );
    }

    let session: { id: string; status: string } | null;
    try {
      session = await deps.findSession(input.sessionId);
    } catch (error) {
      return postErrorResponse(error);
    }

    if (!session) {
      return noStoreJson({ error: "Training session not found" }, 404);
    }

    if (session.status !== "IN_PROGRESS") {
      return noStoreJson(
        { error: "Training session is not accepting speech" },
        409
      );
    }

    const startedAt = deps.now();
    let model: ResolvedMediaModel | null = null;
    let result: SpeechSynthesisResult;

    try {
      model = await deps.resolveModel();
      const speechInput: SpeechSynthesisInput = {
        text: input.text,
        voice: input.voice,
        language: input.language,
        speed: input.speed,
        expression: input.expression,
        instructions: input.instructions
      };
      result = await deps.synthesize(model, speechInput);
    } catch (error) {
      const reasonCode = safeFailureCode(error);
      const latencyMs = Math.max(0, deps.now() - startedAt);

      try {
        await deps.logCall({
          sessionId: input.sessionId,
          capability: "TEXT_TO_SPEECH",
          provider: model?.providerName ?? "unconfigured",
          latencyMs,
          costEstimate: 0,
          success: false,
          failureReason: reasonCode,
          fallbackProvider: "browser-speechSynthesis"
        });
      } catch (logError) {
        return postErrorResponse(logError);
      }

      return noStoreJson({
        mode: "BROWSER_TTS_FALLBACK",
        providerCapability: "TEXT_TO_SPEECH",
        provider: model?.providerName ?? null,
        model: model?.modelName ?? null,
        fallbackUsed: true,
        reasonCode,
        speech: {
          text: input.text,
          language: input.language,
          voice: "browser-default",
          speed: input.speed,
          audioUrl: null,
          instructions: "请使用浏览器 speechSynthesis 朗读。"
        }
      });
    }

    const latencyMs = Math.max(0, deps.now() - startedAt);
    try {
      await deps.logCall({
        sessionId: input.sessionId,
        capability: "TEXT_TO_SPEECH",
        provider: result.provider,
        latencyMs,
        costEstimate: 0,
        success: true,
        failureReason: null,
        fallbackProvider: null
      });
    } catch (error) {
      return postErrorResponse(error);
    }

    return noStoreJson({
      mode: "ALIBABA_TTS",
      providerCapability: "TEXT_TO_SPEECH",
      provider: result.provider,
      model: result.model,
      traceId: result.traceId,
      fallbackUsed: false,
      speech: {
        text: input.text,
        language: input.language,
        voice: configuredVoice(model, input.voice),
        speed: input.speed,
        audioBase64: "audioBase64" in result ? result.audioBase64 : null,
        mimeType: result.mimeType,
        sampleRate: result.sampleRate ?? null,
        expiresAt: result.expiresAt ?? null
      }
    });
  };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import {
  resolveMediaModel,
  type ResolvedMediaModel
} from "@/lib/media/config";
import { MediaConfigurationError } from "@/lib/media/errors";
import { resolveAlibabaAsrAudioConfig } from "@/lib/media/providers/alibabaAsr";
import { resolveAlibabaAsrCredentials } from "@/lib/media/providers/alibabaCredentials";
import type { RealtimeTicketPayload } from "@/lib/realtime/tickets";
import { realtimeTicketStore } from "@/lib/realtime/tickets";
import { consumeRateLimit as consumeRequestRateLimit } from "@/lib/security/requestGuards";
import { authenticateRenderActor } from "@/lib/security/renderRouteAuth";

const ticketTtlMs = 60_000;
const requestSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200)
  })
  .strict();

type SpeechRecognitionSessionDependencies = {
  authenticate: (request: Request) => Promise<{ type: string; trainingSessionId?: string } | null>;
  findSession: (
    sessionId: string
  ) => Promise<{ id: string; status: string } | null>;
  resolveModel: (
    capability: "SPEECH_TO_TEXT"
  ) => Promise<ResolvedMediaModel>;
  validateCredentials: (model: ResolvedMediaModel) => unknown;
  issueTicket: (payload: RealtimeTicketPayload, ttlMs: number) => string;
  consumeRateLimit: (
    key: string,
    limit: number,
    windowMs: number
  ) => { allowed: boolean; remaining: number; resetAt: number };
  now: () => number;
};

function defaultDependencies(): SpeechRecognitionSessionDependencies {
  return {
    authenticate: authenticateRenderActor,
    findSession: (sessionId) =>
      prisma.trainingSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true }
      }),
    resolveModel: resolveMediaModel,
    validateCredentials: resolveAlibabaAsrCredentials,
    issueTicket: (payload, ttlMs) =>
      realtimeTicketStore.issue(payload, ttlMs),
    consumeRateLimit: consumeRequestRateLimit,
    now: Date.now
  };
}

export function createSpeechRecognitionSessionHandler(
  overrides: Partial<SpeechRecognitionSessionDependencies> = {}
) {
  const deps = { ...defaultDependencies(), ...overrides };

  return async function handleSpeechRecognitionSession(request: Request) {
    try {
      const input = requestSchema.parse(await request.json());
      // Admins reach this route through the middleware; a candidate may only open ASR for its own session.
      const actor = await deps.authenticate(request).catch(() => null);
      if (actor?.type === "candidate" && actor.trainingSessionId !== input.sessionId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const rateLimit = deps.consumeRateLimit(
        `POST:/api/speech-recognition/sessions:${input.sessionId}`,
        10,
        60_000
      );

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error: "Too many requests",
            message: "请稍后再创建语音识别连接。"
          },
          { status: 429 }
        );
      }

      const session = await deps.findSession(input.sessionId);

      if (!session) {
        return NextResponse.json(
          { error: "Training session not found" },
          { status: 404 }
        );
      }

      if (session.status !== "IN_PROGRESS") {
        return NextResponse.json(
          { error: "Training session is not accepting audio" },
          { status: 409 }
        );
      }

      const model = await deps.resolveModel("SPEECH_TO_TEXT");
      deps.validateCredentials(model);
      const audio = resolveAlibabaAsrAudioConfig(model);
      const issuedAt = deps.now();
      const ticket = deps.issueTicket(
        { sessionId: session.id, modelId: model.modelId },
        ticketTtlMs
      );

      return NextResponse.json(
        {
          mode: "ALIBABA_REALTIME_ASR",
          webSocketUrl: `/ws/asr?ticket=${encodeURIComponent(ticket)}`,
          expiresAt: new Date(issuedAt + ticketTtlMs).toISOString(),
          model: model.modelName,
          audio: {
            format: audio.encoding,
            sampleRate: audio.sampleRate,
            channels: audio.channels,
            language: audio.language
          }
        },
        {
          status: 201,
          headers: { "Cache-Control": "no-store" }
        }
      );
    } catch (error) {
      if (error instanceof MediaConfigurationError) {
        return NextResponse.json(
          {
            error: "Speech recognition unavailable",
            code: error.code,
            message: "请先在后台完成当前语音识别模型配置。"
          },
          { status: 503 }
        );
      }

      return postErrorResponse(error);
    }
  };
}

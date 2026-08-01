import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveMediaModel, type ResolvedMediaModel } from "@/lib/media/config";
import { createAlibabaTtsProvider } from "@/lib/media/providers/alibabaTts";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";
import { resolveVideoSpeechSynthesisInput, type VideoSpeechProfile } from "@/lib/media/video/speechAsset";
import type { SpeechPcmStreamResult, SpeechSynthesisInput } from "@/lib/media/types";
import { authenticateRenderActor } from "@/lib/security/renderRouteAuth";
import { consumeRateLimit as consumeRequestRateLimit } from "@/lib/security/requestGuards";

const schema = z.object({ sessionId: z.string().trim().min(1).max(200), questionId: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(600) }).strict();
type FallbackSpeechContext = { session: { id: string; candidateId: string; status: string }; question: { id: string; stage: string; text: string; behaviorSignals: Record<string, unknown> | null }; profile: VideoSpeechProfile | null };
type SpeechCallLog = { sessionId: string; capability: "TEXT_TO_SPEECH"; provider: string; latencyMs: number; costEstimate: number; success: boolean; failureReason: string | null; fallbackProvider: string | null };
type Dependencies = {
  authenticate: typeof authenticateRenderActor;
  findSpeechContext: (sessionId: string, questionId: string) => Promise<FallbackSpeechContext | null>;
  resolveModel: () => Promise<ResolvedMediaModel>;
  streamPcm?: (input: SpeechSynthesisInput) => Promise<SpeechPcmStreamResult>;
  logCall: (data: SpeechCallLog) => Promise<unknown>;
  consumeRateLimit: (key: string, limit: number, windowMs: number) => { allowed: boolean };
  now: () => number;
};

export function createFallbackSpeechHandler(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    authenticate: authenticateRenderActor,
    findSpeechContext: findDefaultSpeechContext,
    resolveModel: () => resolveMediaModel("TEXT_TO_SPEECH"),
    logCall: (data) => prisma.aiCallLog.create({ data }),
    consumeRateLimit: consumeRequestRateLimit,
    now: Date.now,
    ...overrides
  };
  return async function handler(request: Request) {
    const actor = await deps.authenticate(request).catch(() => null);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (actor.type !== "candidate") return json({ error: "Forbidden" }, 403);
    let input: z.infer<typeof schema>;
    try { input = schema.parse(await request.json()); } catch { return json({ error: "Validation failed" }, 400); }
    if (actor.type === "candidate" && actor.trainingSessionId !== input.sessionId) return json({ error: "Forbidden" }, 403);
    if (!deps.consumeRateLimit(`fallback-speech:${input.sessionId}`, 30, 60_000).allowed) return json({ error: "Too many requests" }, 429);
    const context = await deps.findSpeechContext(input.sessionId, input.questionId).catch(() => null);
    if (!context) return json({ error: "Session not found" }, 404);
    const { session, question, profile } = context;
    if (actor.type === "candidate" && actor.candidateId !== session.candidateId) return json({ error: "Forbidden" }, 403);
    if (session.status !== "IN_PROGRESS") return json({ error: "Session is not active" }, 409);
    if (question.id !== input.questionId || question.text !== input.text) return json({ error: "Unknown session question" }, 400);
    const startedAt = deps.now(); let model: ResolvedMediaModel | null = null; let result: SpeechPcmStreamResult;
    try {
      model = await deps.resolveModel();
      if (!profile?.enabled) throw new Error("profile unavailable");
      const speechInput = resolveVideoSpeechSynthesisInput({ question: question.text, stage: question.stage, behaviorSignals: question.behaviorSignals, profile, model });
      result = deps.streamPcm ? await deps.streamPcm(speechInput) : await createAlibabaTtsProvider(model).streamPcm(speechInput);
    } catch {
      await deps.logCall(log(session.id, model?.providerName ?? "unconfigured", deps.now() - startedAt, false, "TTS_UNAVAILABLE")).catch(() => undefined);
      return json({ mode: "BROWSER_TTS_FALLBACK", reasonCode: "TTS_UNAVAILABLE" }, 503);
    }
    const iterator = result.chunks[Symbol.asyncIterator](); let finalized = false;
    const finalize = async (success: boolean, code: string | null) => { if (finalized) return; finalized = true; await deps.logCall(log(session.id, result.provider, deps.now() - startedAt, success, code)).catch(() => undefined); };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) { try { const next = await iterator.next(); if (next.done) { await finalize(true, null); controller.close(); } else controller.enqueue(next.value); } catch { await iterator.return?.().catch(() => undefined); await finalize(false, "TTS_STREAM_FAILED"); controller.error(new Error("TTS stream failed")); } },
      async cancel() { await iterator.return?.().catch(() => undefined); await finalize(false, "TTS_CANCELLED"); }
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "audio/pcm", "Cache-Control": "private, no-store", "X-Audio-Format": "pcm_s16le", "X-Audio-Sample-Rate": "48000", "X-Audio-Channels": "1", "X-Content-Type-Options": "nosniff" } });
  };
}

async function findDefaultSpeechContext(sessionId: string, questionId: string): Promise<FallbackSpeechContext | null> {
  const placeholder = await prisma.digitalHumanRenderPlaceholder.findFirst({ where: { trainingSessionId: sessionId, questionId }, orderBy: { updatedAt: "desc" }, select: { questionId: true, questionText: true, stage: true, behaviorSignalsJson: true, runtimeSettingsJson: true, trainingSession: { select: { id: true, candidateId: true, status: true } } } });
  if (!placeholder) return null;
  let profile: VideoSpeechProfile | null = null;
  if (placeholder.runtimeSettingsJson) {
    const settings = parseDigitalHumanVideoRuntimeSettings(placeholder.runtimeSettingsJson);
    profile = await prisma.interviewerAvatarProfile.findUnique({ where: { id: settings.primaryProfileId }, select: { id: true, voice: true, styleJson: true, enabled: true } });
  }
  return { session: placeholder.trainingSession, question: { id: placeholder.questionId, stage: placeholder.stage, text: placeholder.questionText, behaviorSignals: parseSignals(placeholder.behaviorSignalsJson) }, profile };
}
function parseSignals(value: string | null) { if (!value) return null; try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; } }
function log(sessionId: string, provider: string, latencyMs: number, success: boolean, failureReason: string | null) { return { sessionId, capability: "TEXT_TO_SPEECH" as const, provider, latencyMs: Math.max(0, latencyMs), costEstimate: 0, success, failureReason, fallbackProvider: success ? null : "browser-speechSynthesis" }; }
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

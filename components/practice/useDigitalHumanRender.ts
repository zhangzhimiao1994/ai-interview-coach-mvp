"use client";

import { useEffect, useRef, useState } from "react";

export type DigitalHumanRenderSnapshot = {
  renderId: string;
  status: string;
  deadlineAt: string;
  elapsedMs: number;
  providerLabel: string | null;
  interviewerDisplayName: string | null;
  fallback: { active: boolean; reason: string | null };
  playbackUrl?: string;
};

type RenderHookInput = {
  sessionId?: string;
  questionId?: string;
  kind?: "PRESET" | "DYNAMIC";
  enabled?: boolean;
  fetcher?: typeof fetch;
};

type HookState = { phase: "IDLE" | "STARTING" | "ACTIVE" | "FALLBACK"; snapshot: DigitalHumanRenderSnapshot | null; key?: string };
type StartEntry = { promise: Promise<DigitalHumanRenderSnapshot>; controller: AbortController; subscribers: number };
const starts = new Map<string, StartEntry>();
const visibleStatuses = new Set(["PENDING", "SUBMITTED", "RACING", "READY", "FALLBACK", "FAILED", "EXPIRED"]);
const terminal = new Set(["READY", "FALLBACK", "FAILED", "EXPIRED"]);

export function useDigitalHumanRender(input: RenderHookInput): HookState {
  const requestedKey = input.sessionId && input.questionId ? `${input.sessionId.trim()}:${input.questionId.trim()}:${input.kind ?? "PRESET"}` : undefined;
  const [state, setState] = useState<HookState>({ phase: input.enabled === false ? "IDLE" : "STARTING", snapshot: null, key: requestedKey });
  const generation = useRef(0);
  useEffect(() => {
    const sessionId = input.sessionId?.trim(); const questionId = input.questionId?.trim();
    if (input.enabled === false || !sessionId || !questionId) { setState({ phase: "IDLE", snapshot: null }); return; }
    const current = ++generation.current;
    const controller = new AbortController();
    const fetcher = input.fetcher ?? fetch;
    const key = `${sessionId}:${questionId}:${input.kind ?? "PRESET"}`;
    let entry = starts.get(key);
    if (!entry) {
      const sharedController = new AbortController();
      const promise = fetcher("/api/digital-human/renders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, questionId, kind: input.kind ?? "PRESET" }), signal: sharedController.signal
      }).then(readSnapshot);
      entry = { promise, controller: sharedController, subscribers: 0 };
      starts.set(key, entry);
      void promise.finally(() => setTimeout(() => { if (starts.get(key) === entry && entry!.subscribers === 0) starts.delete(key); }, 0)).catch(() => undefined);
    }
    entry.subscribers += 1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    setState({ phase: "STARTING", snapshot: null, key });
    const deadlineTimer = setTimeout(() => {
      if (generation.current !== current) return;
      generation.current += 1;
      controller.abort();
      entry!.controller.abort();
      setState({ phase: "FALLBACK", snapshot: fallbackSnapshot(startedAt), key });
    }, 8_000);
    void entry.promise.then(async (initial) => {
      if (generation.current !== current || controller.signal.aborted) return;
      let snapshot = initial;
      const serverDeadline = Date.parse(snapshot.deadlineAt);
      const deadline = Math.min(startedAt + 8_000, Number.isFinite(serverDeadline) ? serverDeadline : startedAt + 8_000);
      while (generation.current === current && !controller.signal.aborted) {
        if (terminal.has(snapshot.status)) { clearTimeout(deadlineTimer); setState({ phase: snapshot.status === "READY" ? "ACTIVE" : "FALLBACK", snapshot, key }); return; }
        if (Date.now() >= deadline) {
          clearTimeout(deadlineTimer); setState({ phase: "FALLBACK", snapshot: { ...snapshot, status: "FALLBACK", fallback: { active: true, reason: "CLIENT_RENDER_DEADLINE" } }, key }); return;
        }
        setState({ phase: "ACTIVE", snapshot, key });
        await new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.min(1_200, Math.max(200, deadline - Date.now()))); });
        if (controller.signal.aborted || generation.current !== current) return;
        if (Date.now() >= deadline) {
          clearTimeout(deadlineTimer); setState({ phase: "FALLBACK", snapshot: { ...snapshot, status: "FALLBACK", fallback: { active: true, reason: "CLIENT_RENDER_DEADLINE" } }, key }); return;
        }
        try {
          snapshot = await readSnapshot(await fetcher(`/api/digital-human/renders/${encodeURIComponent(snapshot.renderId)}`, { signal: controller.signal }));
        } catch {
          if (controller.signal.aborted) return;
          clearTimeout(deadlineTimer); setState({ phase: "FALLBACK", snapshot: { ...snapshot, status: "FALLBACK", fallback: { active: true, reason: "CLIENT_POLL_FAILED" } }, key }); return;
        }
      }
    }).catch(() => {
      if (generation.current === current && !controller.signal.aborted) { clearTimeout(deadlineTimer); setState({ phase: "FALLBACK", snapshot: fallbackSnapshot(startedAt), key }); }
    });
    return () => { generation.current += 1; controller.abort(); clearTimeout(deadlineTimer); if (timer) clearTimeout(timer); entry!.subscribers -= 1; queueMicrotask(() => { if (entry!.subscribers === 0 && starts.get(key) === entry) { entry!.controller.abort(); starts.delete(key); } }); };
  }, [input.enabled, input.fetcher, input.kind, input.questionId, input.sessionId]);
  return state.key === requestedKey ? state : { phase: requestedKey ? "STARTING" : "IDLE", snapshot: null };
}

async function readSnapshot(response: Response) {
  if (!response.ok) throw new Error("RENDER_REQUEST_FAILED");
  const value = await response.json() as Partial<DigitalHumanRenderSnapshot>;
  if (!value.renderId || !value.status || !visibleStatuses.has(value.status) || !value.deadlineAt || !value.fallback || typeof value.fallback.active !== "boolean") throw new Error("RENDER_RESPONSE_INVALID");
  const expectedPlaybackUrl = `/api/digital-human/renders/${encodeURIComponent(value.renderId)}?playback=1`;
  if (value.status === "READY" && value.playbackUrl !== expectedPlaybackUrl) throw new Error("RENDER_PLAYBACK_URL_INVALID");
  if (value.playbackUrl && value.playbackUrl !== expectedPlaybackUrl) throw new Error("RENDER_PLAYBACK_URL_INVALID");
  return value as DigitalHumanRenderSnapshot;
}
function fallbackSnapshot(startedAt: number): DigitalHumanRenderSnapshot { return { renderId: "unavailable", status: "FALLBACK", deadlineAt: new Date(startedAt + 8_000).toISOString(), elapsedMs: 0, providerLabel: null, interviewerDisplayName: null, fallback: { active: true, reason: "CLIENT_RENDER_START_FAILED" } }; }

"use client";

import React, { useEffect, useRef, useState } from "react";
import { BoundedTtlMap } from "@/lib/client/boundedTtlMap";
import { LocalQwenInterviewer } from "./DigitalInterviewerVideo";
import { useDigitalHumanRender, type DigitalHumanRenderSnapshot } from "./useDigitalHumanRender";

const fallbackNodes = new WeakMap<() => React.ReactNode, BoundedTtlMap<string, React.ReactNode>>();

type Props = {
  question: string;
  stage?: string;
  sessionId?: string;
  questionId?: string;
  kind?: "PRESET" | "DYNAMIC";
  snapshot?: DigitalHumanRenderSnapshot;
  renderFallback?: () => React.ReactNode;
};

export function DigitalHumanVideoPlayback({ question, stage = "Interview", sessionId, questionId, kind = "PRESET", snapshot: supplied, renderFallback }: Props) {
  const hook = useDigitalHumanRender({ sessionId, questionId, kind, enabled: !supplied && Boolean(sessionId && questionId) });
  const incoming = supplied ?? hook.snapshot;
  const identity = `${sessionId ?? "test"}:${questionId ?? question}`;
  const identityRef = useRef(identity);
  const [latchedState, setLatchedState] = useState<{ key: string; snapshot: DigitalHumanRenderSnapshot | null }>({ key: identity, snapshot: incoming ?? null });
  const latched = latchedState.key === identity ? latchedState.snapshot : incoming ?? null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playedKey = useRef<string | null>(null);
  const activeVideoMedia = useRef<{ key: string; video: HTMLVideoElement } | null>(null);
  const [manualPlay, setManualPlay] = useState(false);

  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity; playedKey.current = null; setManualPlay(false); setLatchedState({ key: identity, snapshot: incoming ?? null }); return;
    }
    setLatchedState((currentState) => {
      const current = currentState.key === identity ? currentState.snapshot : null;
      if (current && ["READY", "FALLBACK", "FAILED", "EXPIRED"].includes(current.status)) return currentState;
      return { key: identity, snapshot: incoming ?? current };
    });
  }, [identity, incoming]);

  const status = latched?.status ?? "PENDING";
  const fallback = ["FALLBACK", "FAILED", "EXPIRED"].includes(status);
  const fallbackNode = fallback
    ? renderFallback ? cachedFallback(renderFallback, identity) : sessionId && questionId ? <LocalQwenInterviewer interviewerName="AI Interviewer" stage={stage} prompt={question} sessionId={sessionId} questionId={questionId} /> : <div data-testid="local-qwen-interviewer">Local avatar fallback</div>
    : null;

  useEffect(() => {
    const video = videoRef.current;
    const mediaKey = status === "READY" && video && latched?.playbackUrl ? `${identity}:${latched.playbackUrl}` : null;
    const previous = activeVideoMedia.current;
    if (previous && previous.key !== mediaKey) {
      previous.video.pause(); previous.video.currentTime = 0;
      if (!video || previous.video !== video) previous.video.removeAttribute("src");
      previous.video.load();
    }
    if (!mediaKey || !video) { activeVideoMedia.current = null; return; }
    const owner = { key: mediaKey, video };
    activeVideoMedia.current = owner;
    if (playedKey.current !== identity) {
      playedKey.current = identity;
      void video.play().catch((error) => {
        if (error instanceof DOMException && error.name === "NotAllowedError") setManualPlay(true);
      });
    }
    return () => { queueMicrotask(() => { if (activeVideoMedia.current !== owner) return; activeVideoMedia.current = null; video.pause(); video.removeAttribute("src"); video.currentTime = 0; video.load(); }); };
  }, [identity, latched?.playbackUrl, status]);

  return <section className="grid gap-3 rounded-lg border border-line bg-panel p-4" aria-label="Digital interviewer video">
    {status === "READY" && latched?.playbackUrl ? <>
      <video ref={videoRef} src={latched.playbackUrl} playsInline preload="metadata" className="aspect-video w-full rounded-md bg-slate-950 object-contain" />
      <p className="text-xs text-muted">{latched.interviewerDisplayName ?? "AI Interviewer"} · {latched.providerLabel ?? "Alibaba video"}</p>
      {manualPlay ? <button type="button" aria-label="Play interviewer video" onClick={() => { setManualPlay(false); void videoRef.current?.play().catch(() => setManualPlay(true)); }}>Play video</button> : null}
    </> : fallback ? fallbackNode : <div className="flex min-h-56 items-center justify-center rounded-md bg-slate-950 text-sm text-white" data-testid="digital-human-generating">Generating interviewer video…</div>}
    <p className="text-base leading-7 text-ink">{question}</p>
  </section>;
}

function cachedFallback(factory: () => React.ReactNode, identity: string) {
  let values = fallbackNodes.get(factory);
  if (!values) { values = new BoundedTtlMap(128, 30 * 60_000); fallbackNodes.set(factory, values); }
  if (values.get(identity) === undefined) values.set(identity, factory());
  return values.get(identity) ?? null;
}

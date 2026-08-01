import React, { StrictMode } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DigitalHumanVideoPlayback } from "@/components/practice/DigitalHumanVideoPlayback";
import { useDigitalHumanRender } from "@/components/practice/useDigitalHumanRender";
import { BoundedTtlMap } from "@/lib/client/boundedTtlMap";

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function snapshot(status: string, extra: Record<string, unknown> = {}) {
  return {
    renderId: "render-1",
    status,
    deadlineAt: new Date(Date.now() + 8_000).toISOString(),
    elapsedMs: 0,
    providerLabel: null,
    interviewerDisplayName: null,
    fallback: { active: status === "FALLBACK", reason: null },
    ...extra
  };
}

describe("useDigitalHumanRender", () => {
  it("starts once in StrictMode, polls with bounded delay, and falls back by eight seconds", async () => {
    vi.useFakeTimers();
    let posts = 0;
    let gets = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        posts += 1;
        return Response.json(snapshot("PENDING"), { status: 202 });
      }
      if (url.includes("render-1")) {
        gets += 1;
        return Response.json(snapshot("RACING"));
      }
      throw new Error(`unexpected ${url}`);
    };
    function Harness() {
      const state = useDigitalHumanRender({ sessionId: "session-1", questionId: "question-1", kind: "PRESET", fetcher });
      return <span>{state.snapshot?.status ?? state.phase}</span>;
    }
    await act(async () => {
      renderer = TestRenderer.create(<StrictMode><Harness /></StrictMode>);
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_050); });
    expect(posts).toBe(1);
    expect(gets).toBeGreaterThan(0);
    expect(gets).toBeLessThanOrEqual(8);
    expect(JSON.stringify(renderer!.toJSON())).toContain("FALLBACK");
  });

  it("aborts stale generation and ignores its late READY response", async () => {
    let releaseOld: ((response: Response) => void) | null = null;
    const fetcher: typeof fetch = async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { questionId: string } : null;
      if (body?.questionId === "old") return new Promise<Response>((resolve) => { releaseOld = resolve; });
      return Response.json({ ...snapshot("FALLBACK"), renderId: "new-render" }, { status: 202 });
    };
    function Harness({ questionId }: { questionId: string }) {
      const state = useDigitalHumanRender({ sessionId: "session-1", questionId, kind: "PRESET", fetcher });
      return <span>{state.snapshot?.renderId ?? state.phase}</span>;
    }
    await act(async () => { renderer = TestRenderer.create(<Harness questionId="old" />); await Promise.resolve(); });
    await act(async () => { renderer!.update(<Harness questionId="new" />); await Promise.resolve(); });
    await act(async () => { releaseOld?.(Response.json({ ...snapshot("READY"), renderId: "old-render", playbackUrl: "/private-old" })); await Promise.resolve(); });
    expect(JSON.stringify(renderer!.toJSON())).toContain("new-render");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("old-render");
  });

  it("aborts a hung start request and falls back within eight seconds", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
    function Harness() {
      const state = useDigitalHumanRender({ sessionId: "session-hung", questionId: "question-hung", kind: "PRESET", fetcher });
      return <span>{state.snapshot?.status ?? state.phase}</span>;
    }
    await act(async () => { renderer = TestRenderer.create(<Harness />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_050); });
    expect(aborted).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain("FALLBACK");
  });

  it("does not issue another poll after the server deadline elapses during sleep", async () => {
    vi.useFakeTimers();
    let gets = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      if (init?.method === "POST") return Response.json(snapshot("PENDING", { deadlineAt: new Date(Date.now() + 1_000).toISOString() }), { status: 202 });
      gets += 1;
      return new Promise<Response>(() => undefined);
    };
    function Harness() {
      const state = useDigitalHumanRender({ sessionId: "session-deadline", questionId: "question-deadline", kind: "PRESET", fetcher });
      return <span>{state.snapshot?.status ?? state.phase}</span>;
    }
    await act(async () => { renderer = TestRenderer.create(<Harness />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(gets).toBe(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain("FALLBACK");
  });

  it("aborts a hung poll at the earlier server deadline and ignores a late terminal response", async () => {
    vi.useFakeTimers();
    let pollAborted = false;
    let releasePoll: ((response: Response) => void) | null = null;
    const fetcher: typeof fetch = async (_input, init) => {
      if (init?.method === "POST") return Response.json(snapshot("PENDING", { deadlineAt: new Date(Date.now() + 2_000).toISOString() }), { status: 202 });
      return new Promise<Response>((resolve) => {
        releasePoll = resolve;
        init?.signal?.addEventListener("abort", () => { pollAborted = true; }, { once: true });
      });
    };
    function Harness() {
      const state = useDigitalHumanRender({ sessionId: "session-server-deadline", questionId: "question-server-deadline", fetcher });
      return <span>{state.snapshot?.status ?? state.phase}</span>;
    }
    await act(async () => { renderer = TestRenderer.create(<Harness />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_050); });
    expect(pollAborted).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain("FALLBACK");
    await act(async () => { releasePoll?.(Response.json(snapshot("READY", { playbackUrl: "/api/digital-human/renders/render-1?playback=1" }))); await Promise.resolve(); });
    expect(JSON.stringify(renderer!.toJSON())).toContain("FALLBACK");
  });

  it.each([
    snapshot("UNRECOGNIZED"),
    snapshot("READY")
  ])("safely falls back for an invalid render snapshot", async (invalidSnapshot) => {
    const fetcher: typeof fetch = async () => Response.json(invalidSnapshot, { status: 202 });
    function Harness() {
      const state = useDigitalHumanRender({ sessionId: "session-invalid", questionId: `question-${invalidSnapshot.status}`, kind: "PRESET", fetcher });
      return <span>{state.snapshot?.status ?? state.phase}</span>;
    }
    await act(async () => { renderer = TestRenderer.create(<Harness />); await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.stringify(renderer!.toJSON())).toContain("FALLBACK");
  });
});

describe("local Qwen playback cache bounds", () => {
  it("evicts the oldest key at capacity and expires retained entries", () => {
    let now = 0;
    const cache = new BoundedTtlMap<string, boolean>(2, 10, () => now);
    cache.set("one", true);
    cache.set("two", true);
    cache.set("three", true);
    expect(cache.get("one")).toBeUndefined();
    expect(cache.size).toBe(2);
    now = 11;
    expect(cache.get("two")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("DigitalHumanVideoPlayback", () => {
  it.each(["PENDING", "SUBMITTED", "RACING", "READY", "FALLBACK", "FAILED"])("keeps exact question text visible in %s", (status) => {
    act(() => {
      renderer = TestRenderer.create(<DigitalHumanVideoPlayback question="Exact generated follow-up" snapshot={snapshot(status, status === "READY" ? { playbackUrl: "/api/digital-human/renders/render-1?playback=1" } : {})} />);
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("Exact generated follow-up");
  });

  it("plays the project-owned READY video once and offers manual recovery after autoplay rejection", async () => {
    const video = { play: vi.fn(async () => { throw new DOMException("blocked", "NotAllowedError"); }), pause: vi.fn(), currentTime: 0, removeAttribute: vi.fn(), load: vi.fn() };
    await act(async () => {
      renderer = TestRenderer.create(<StrictMode><DigitalHumanVideoPlayback question="Q" snapshot={snapshot("READY", {
        playbackUrl: "/api/digital-human/renders/render-1?playback=1",
        providerLabel: "Lingmou Broadcast",
        interviewerDisplayName: "Lin"
      })} /></StrictMode>, { createNodeMock: (node) => node.type === "video" ? video : null });
      await Promise.resolve();
    });
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.removeAttribute).not.toHaveBeenCalled();
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("Lingmou Broadcast");
    expect(text).toContain("Lin");
    expect(renderer!.root.findByProps({ "aria-label": "Play interviewer video" })).toBeTruthy();
    expect(text).not.toMatch(/oss-|aliyuncs|signed/i);
    await act(async () => { renderer!.unmount(); await Promise.resolve(); });
    renderer = null;
    expect(video.removeAttribute).toHaveBeenCalledTimes(1);
  });

  it("uses one local Qwen fallback and never replaces it with a late READY result", async () => {
    let localStarts = 0;
    const fallback = () => { localStarts += 1; return <div data-testid="local-qwen-avatar">local</div>; };
    await act(async () => { renderer = TestRenderer.create(<StrictMode><DigitalHumanVideoPlayback question="Q1" snapshot={snapshot("FALLBACK")} renderFallback={fallback} /></StrictMode>); });
    expect(localStarts).toBe(1);
    await act(async () => { renderer!.update(<StrictMode><DigitalHumanVideoPlayback question="Q1" snapshot={snapshot("READY", { playbackUrl: "/api/digital-human/renders/render-1?playback=1" })} renderFallback={fallback} /></StrictMode>); });
    expect(renderer!.root.findByProps({ "data-testid": "local-qwen-avatar" })).toBeTruthy();
    expect(renderer!.root.findAllByType("video")).toHaveLength(0);
  });

  it("stops prior READY media on identity change without removing the next source", async () => {
    const video = { play: vi.fn(async () => undefined), pause: vi.fn(), currentTime: 0, removeAttribute: vi.fn(), load: vi.fn() };
    await act(async () => { renderer = TestRenderer.create(<DigitalHumanVideoPlayback question="Q1" sessionId="s-video" questionId="q1" snapshot={snapshot("READY", { playbackUrl: "/api/digital-human/renders/render-1?playback=1" })} />, { createNodeMock: (node) => node.type === "video" ? video : null }); await Promise.resolve(); });
    await act(async () => { renderer!.update(<DigitalHumanVideoPlayback question="Q2" sessionId="s-video" questionId="q2" snapshot={{ ...snapshot("READY", { playbackUrl: "/api/digital-human/renders/render-2?playback=1" }), renderId: "render-2" }} />); await Promise.resolve(); });
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.removeAttribute).not.toHaveBeenCalled();
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("uses the project Qwen fallback once without creating a legacy realtime session", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(Uint8Array.from([1, 0, 2, 0]), { status: 200, headers: { "content-type": "audio/pcm" } });
    };
    const audio = { play: vi.fn(async () => undefined), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), currentTime: 0, src: "", currentSrc: "" };
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:qwen", revokeObjectURL: () => undefined });
    await act(async () => {
      renderer = TestRenderer.create(<StrictMode><DigitalHumanVideoPlayback question="Qwen question" stage="Formal" sessionId="session-qwen" questionId="question-qwen" snapshot={snapshot("FALLBACK")} /></StrictMode>, { createNodeMock: (node) => node.type === "audio" ? audio : null });
      await Promise.resolve(); await Promise.resolve();
    });
    expect(requests).toEqual(["/api/digital-human/fallback-speech"]);
    expect(requests.some((url) => url.includes("/api/digital-human/sessions"))).toBe(false);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("shares a StrictMode Qwen request but aborts it after the last subscriber switches question", async () => {
    const requests: string[] = [];
    let oldAborted = false;
    let resolveNew: ((response: Response) => void) | null = null;
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { questionId: string };
      requests.push(body.questionId);
      return new Promise<Response>((resolve, reject) => {
        if (body.questionId === "q-new") resolveNew = resolve;
        init?.signal?.addEventListener("abort", () => {
          if (body.questionId === "q-old") oldAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    };
    const audio = { play: vi.fn(async () => undefined), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), currentTime: 0, src: "", currentSrc: "" };
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:qwen-switch", revokeObjectURL: () => undefined });
    await act(async () => { renderer = TestRenderer.create(<StrictMode><DigitalHumanVideoPlayback question="Old" sessionId="session-switch" questionId="q-old" snapshot={snapshot("FALLBACK")} /></StrictMode>, { createNodeMock: (node) => node.type === "audio" ? audio : null }); await Promise.resolve(); });
    expect(requests).toEqual(["q-old"]);
    await act(async () => { renderer!.update(<StrictMode><DigitalHumanVideoPlayback question="New" sessionId="session-switch" questionId="q-new" snapshot={{ ...snapshot("FALLBACK"), renderId: "render-new" }} /></StrictMode>); await Promise.resolve(); await Promise.resolve(); });
    expect(oldAborted).toBe(true);
    expect(requests).toEqual(["q-old", "q-new"]);
    await act(async () => { resolveNew?.(new Response(Uint8Array.from([1, 0]), { status: 200, headers: { "content-type": "audio/pcm" } })); await Promise.resolve(); await Promise.resolve(); });
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
});

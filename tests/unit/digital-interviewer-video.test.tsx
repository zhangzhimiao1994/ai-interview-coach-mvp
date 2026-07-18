import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer
} from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const lingmou = vi.hoisted(() => {
  const client = {
    start: vi.fn(async (): Promise<void> => undefined),
    pushPcm: vi.fn(),
    interrupt: vi.fn(),
    exit: vi.fn()
  };
  return {
    client,
    createClient: vi.fn(async () => client)
  };
});

vi.mock("@/lib/client/lingmouAvatarClient", () => ({
  createLingmouAvatarClient: lingmou.createClient
}));

import {
  DigitalInterviewerVideo,
  stopInterviewerSpeech
} from "@/components/practice/DigitalInterviewerVideo";

class FakeSpeechSynthesisUtterance {
  lang = "";
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly text: string) {}
}

function createAudioMock() {
  let source = "";
  return {
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    removeAttribute: vi.fn((name: string) => {
      if (name === "src") source = "";
    }),
    load: vi.fn(),
    currentTime: 0,
    get currentSrc() {
      return source;
    },
    get src() {
      return source;
    },
    set src(value: string) {
      source = value;
    }
  } as unknown as HTMLAudioElement;
}

const connection = {
  appId: "rtc-app",
  avatarUserId: "avatar-user",
  channel: "rtc-channel",
  clientUserId: "client-user",
  serverUserId: "server-user",
  timestamp: 1_721_234_567,
  token: "short-lived-token",
  sessionId: "provider-session"
};

function sessionResponse(mode: "LINGMOU_CLOUD" | "LOCAL_AVATAR") {
  return Response.json(
    {
      session: {
        id: "digital-session-1",
        mode,
        status: "READY",
        reasonCode: mode === "LOCAL_AVATAR" ? "LINGMOU_NOT_CONFIGURED" : null,
        connection: mode === "LINGMOU_CLOUD" ? connection : null,
        expiresAt: "2026-07-18T01:00:00.000Z"
      }
    },
    { status: 201 }
  );
}

function downgradeResponse() {
  return Response.json({
    session: {
      id: "digital-session-1",
      mode: "LOCAL_AVATAR",
      status: "READY",
      reasonCode: "CLIENT_RUNTIME_FAILED",
      connection: null,
      expiresAt: "2026-07-18T01:00:00.000Z"
    }
  });
}

function pcmResponse(chunks: number[][]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
        controller.close();
      }
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "audio/pcm",
        "X-Audio-Format": "pcm_s16le",
        "X-Audio-Sample-Rate": "48000",
        "X-Audio-Channels": "1"
      }
    }
  );
}

function fallbackResponse() {
  return Response.json(
    { mode: "BROWSER_TTS_FALLBACK", reasonCode: "TTS_UNAVAILABLE" },
    { status: 503 }
  );
}

function createFetchRouter(options: {
  mode?: "LINGMOU_CLOUD" | "LOCAL_AVATAR";
  speech?: () => Promise<Response> | Response;
} = {}) {
  const mode = options.mode ?? "LOCAL_AVATAR";
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/digital-human/sessions" && init?.method === "POST") {
      return sessionResponse(mode);
    }
    if (url.endsWith("/speech") && init?.method === "POST") {
      return options.speech?.() ?? pcmResponse([[1, 0, 2, 0]]);
    }
    if (url.endsWith("/heartbeat") && init?.method === "POST") {
      return Response.json({ ok: true });
    }
    if (url.endsWith("/downgrade") && init?.method === "POST") {
      return downgradeResponse();
    }
    if (url === "/api/digital-human/sessions/digital-session-1" && init?.method === "DELETE") {
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
}

const mountedRenderers: ReactTestRenderer[] = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const renderer of mountedRenderers.splice(0)) renderer.unmount();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setupInteractiveBrowser(audio = createAudioMock()) {
  const speechSynthesis = {
    cancel: vi.fn(),
    pause: vi.fn(),
    speak: vi.fn()
  };
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:interviewer-audio-${blobs.length}`;
  });
  const revokeObjectURL = vi.fn();

  vi.stubGlobal("window", {
    speechSynthesis,
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance
  });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

  return {
    audio,
    blobs,
    speechSynthesis,
    createObjectURL,
    revokeObjectURL
  };
}

async function flushEffects() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

async function renderInteractive(
  audio: HTMLAudioElement,
  overrides: Partial<React.ComponentProps<typeof DigitalInterviewerVideo>> = {}
) {
  const avatarRoot = {} as HTMLVideoElement;
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(
      <DigitalInterviewerVideo
        interviewerName="AI 面试官"
        stage="正式面试"
        prompt="请介绍一下你自己。"
        sessionId="training-session-1"
        questionId="question-1"
        {...overrides}
      />,
      {
        createNodeMock: (element) => {
          if (element.type === "audio") return audio;
          const props = element.props as Record<string, unknown>;
          if (props["data-testid"] === "lingmou-avatar-root") {
            return avatarRoot;
          }
          return null;
        }
      }
    );
  });
  const mounted = renderer as ReactTestRenderer | null;
  if (!mounted) throw new Error("Interactive renderer was not created");
  mountedRenderers.push(mounted);
  await flushEffects();
  return { renderer: mounted, avatarRoot };
}

function findReplayButton(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("button").find((button) =>
    String(button.props.children).includes("重播")
  ) as ReactTestInstance;
}

describe("DigitalInterviewerVideo", () => {
  it("renders SSR safely with stable Lingmou and fallback copy without loading the SDK", () => {
    const markup = renderToStaticMarkup(
      <DigitalInterviewerVideo
        interviewerName="林夏"
        stage="正式面试"
        prompt="请介绍项目经验。"
        sessionId="training-session-1"
        questionId="question-1"
      />
    );

    expect(markup).toContain('data-testid="lingmou-avatar-root"');
    expect(markup).toContain('<video');
    expect(markup).toContain("灵眸真实数字人 / 本地数字人降级");
    expect(markup).toContain("CosyVoice / 浏览器语音降级");
    expect(markup).toContain("AI 生成数字人");
    expect(markup).toContain("请介绍项目经验。");
    expect(lingmou.createClient).not.toHaveBeenCalled();
  });

  it("keeps fallback visible and does not auto-play until cloud readiness resolves", async () => {
    const { audio } = setupInteractiveBrowser();
    let resolveReadiness: (() => void) | undefined;
    lingmou.client.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveReadiness = resolve;
        })
    );
    const fetchMock = createFetchRouter({ mode: "LINGMOU_CLOUD" });
    vi.stubGlobal("fetch", fetchMock);

    const { renderer } = await renderInteractive(audio);
    const speechCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/speech"));

    expect(
      renderer.root.findAll(
        (node) => node.props["data-testid"] === "local-avatar-fallback"
      )
    ).toHaveLength(1);
    expect(speechCalls()).toHaveLength(0);
    expect(lingmou.client.pushPcm).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();

    await act(async () => {
      resolveReadiness?.();
      await Promise.resolve();
    });
    await flushEffects();

    expect(
      renderer.root.findAll(
        (node) => node.props["data-testid"] === "local-avatar-fallback"
      )
    ).toHaveLength(0);
    expect(speechCalls()).toHaveLength(1);
    expect(lingmou.client.pushPcm).toHaveBeenCalled();
  });

  it("streams cloud PCM with one-chunk lookahead and never plays hidden audio", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    const fetchMock = createFetchRouter({
      mode: "LINGMOU_CLOUD",
      speech: () => pcmResponse([[1, 0, 2], [0, 3, 0]])
    });
    vi.stubGlobal("fetch", fetchMock);

    const { avatarRoot } = await renderInteractive(audio);

    expect(lingmou.createClient).toHaveBeenCalledOnce();
    expect(lingmou.client.start).toHaveBeenCalledWith(connection, avatarRoot);
    expect(lingmou.client.pushPcm).toHaveBeenNthCalledWith(
      1,
      Int16Array.from([1]),
      false
    );
    expect(lingmou.client.pushPcm).toHaveBeenNthCalledWith(
      2,
      Int16Array.from([2, 3]),
      true
    );
    expect(audio.play).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("aggregates local PCM into WAV and keeps local audio playback active", async () => {
    const { audio, blobs } = setupInteractiveBrowser();
    vi.stubGlobal("fetch", createFetchRouter({
      speech: () => pcmResponse([[0x34], [0x12, 0xfe, 0xff]])
    }));

    await renderInteractive(audio);

    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.src).toBe("blob:interviewer-audio-1");
    expect(blobs).toHaveLength(1);
    const wav = new Uint8Array(await blobs[0].arrayBuffer());
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(Array.from(wav.slice(44))).toEqual([0x34, 0x12, 0xfe, 0xff]);
  });

  it("falls back to browser speech without creating WAV audio for an empty local stream", async () => {
    const { audio, speechSynthesis, createObjectURL } =
      setupInteractiveBrowser();
    vi.stubGlobal(
      "fetch",
      createFetchRouter({ speech: () => pcmResponse([]) })
    );

    await renderInteractive(audio);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it("plays a single local PCM chunk as one WAV payload", async () => {
    const { audio, blobs } = setupInteractiveBrowser();
    vi.stubGlobal(
      "fetch",
      createFetchRouter({ speech: () => pcmResponse([[0x78, 0x56]]) })
    );

    await renderInteractive(audio);

    expect(audio.play).toHaveBeenCalledOnce();
    expect(blobs).toHaveLength(1);
    const wav = new Uint8Array(await blobs[0].arrayBuffer());
    expect(Array.from(wav.slice(44))).toEqual([0x78, 0x56]);
  });

  it("falls back to browser speech when the local PCM reader errors", async () => {
    const { audio, speechSynthesis, createObjectURL } =
      setupInteractiveBrowser();
    vi.stubGlobal(
      "fetch",
      createFetchRouter({
        speech: () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error("stream failed"));
              }
            })
          )
      })
    );

    await renderInteractive(audio);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it("does not let a cancelled local reader overwrite the next question audio", async () => {
    const { audio, speechSynthesis, createObjectURL } =
      setupInteractiveBrowser();
    let oldController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/digital-human/sessions") {
          return sessionResponse("LOCAL_AVATAR");
        }
        if (url.endsWith("/speech")) {
          const body = JSON.parse(String(init?.body)) as { questionId: string };
          if (body.questionId === "question-1") {
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  oldController = controller;
                }
              })
            );
          }
          return pcmResponse([[7, 0]]);
        }
        if (url.endsWith("/heartbeat")) return Response.json({ ok: true });
        if (init?.method === "DELETE") return Response.json({ ok: true });
        throw new Error(`Unexpected request ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const { renderer } = await renderInteractive(audio);
    expect(oldController).toBeDefined();

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="下一道题。"
          sessionId="training-session-1"
          questionId="question-2"
        />
      );
    });
    await flushEffects();

    expect(audio.src).toBe("blob:interviewer-audio-1");
    expect(audio.play).toHaveBeenCalledOnce();

    await act(async () => {
      oldController?.error(new Error("old local stream failed"));
      await Promise.resolve();
    });
    await flushEffects();

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(audio.src).toBe("blob:interviewer-audio-1");
    expect(audio.play).toHaveBeenCalledOnce();
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("retries an autoplay-blocked local audio element without refetching speech", async () => {
    const audio = createAudioMock();
    vi.mocked(audio.play)
      .mockRejectedValueOnce(new DOMException("Playback blocked", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    const { createObjectURL } = setupInteractiveBrowser(audio);
    const fetchMock = createFetchRouter();
    vi.stubGlobal("fetch", fetchMock);
    const { renderer } = await renderInteractive(audio);
    const speechCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/speech"));

    expect(audio.play).toHaveBeenCalledOnce();
    expect(speechCalls()).toHaveLength(1);
    expect(audio.src).toBe("blob:interviewer-audio-1");

    await act(async () => {
      findReplayButton(renderer).props.onClick();
    });
    await flushEffects();

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(speechCalls()).toHaveLength(1);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(audio.src).toBe("blob:interviewer-audio-1");
  });

  it("keeps the visual downgrade notice when cloud SDK startup fails", async () => {
    const { audio } = setupInteractiveBrowser();
    lingmou.client.start.mockRejectedValueOnce(new Error("SDK unavailable"));
    vi.stubGlobal(
      "fetch",
      createFetchRouter({
        mode: "LINGMOU_CLOUD",
        speech: () => pcmResponse([[1, 0, 2, 0]])
      })
    );

    const { renderer } = await renderInteractive(audio);
    const text = JSON.stringify(renderer.toJSON());

    expect(audio.play).toHaveBeenCalledOnce();
    expect(lingmou.client.pushPcm).not.toHaveBeenCalled();
    expect(text).toContain("数字人画面已降级");
  });

  it("stops cloud ownership and calls atomic downgrade exactly once when SDK startup fails", async () => {
    vi.useFakeTimers();
    const { audio } = setupInteractiveBrowser();
    lingmou.client.start.mockRejectedValueOnce(new Error("SDK unavailable"));
    const fetchMock = createFetchRouter({ mode: "LINGMOU_CLOUD" });
    vi.stubGlobal("fetch", fetchMock);

    await renderInteractive(audio);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    const downgradeCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/downgrade") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    const heartbeatCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/heartbeat")
    );

    expect(downgradeCalls).toHaveLength(1);
    expect(JSON.parse(String(downgradeCalls[0]?.[1]?.body))).toEqual({
      reasonCode: "CLIENT_SDK_INIT_FAILED"
    });
    expect(heartbeatCalls).toHaveLength(0);
    expect(lingmou.client.exit).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("atomically downgrades once after PCM push fails and replays locally with the same session id", async () => {
    vi.useFakeTimers();
    const { audio } = setupInteractiveBrowser();
    lingmou.client.pushPcm.mockImplementationOnce(() => {
      throw new Error("runtime push failed");
    });
    const fetchMock = createFetchRouter({ mode: "LINGMOU_CLOUD" });
    vi.stubGlobal("fetch", fetchMock);

    await renderInteractive(audio);
    await flushEffects();
    const downgradeCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/downgrade")
    );
    const speechCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/speech")
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    const heartbeatCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/heartbeat")
    );

    expect(downgradeCalls).toHaveLength(1);
    expect(speechCalls).toHaveLength(2);
    expect(speechCalls.every(([url]) =>
      String(url).includes("digital-session-1")
    )).toBe(true);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(heartbeatCalls).toHaveLength(0);
  });

  it("uses browser speech and leaves recovery to the server when atomic downgrade fails", async () => {
    vi.useFakeTimers();
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    lingmou.client.start.mockRejectedValueOnce(new Error("SDK unavailable"));
    const fallbackRouter = createFetchRouter({ mode: "LINGMOU_CLOUD" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/downgrade")) {
        return Response.json(
          { reasonCode: "DIGITAL_HUMAN_DOWNGRADE_FAILED" },
          { status: 503 }
        );
      }
      return fallbackRouter(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderInteractive(audio);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/downgrade")
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/heartbeat")
    )).toHaveLength(0);
    expect(audio.play).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it("uses browser speech only after the speech route explicitly falls back", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    vi.stubGlobal("fetch", createFetchRouter({ speech: fallbackResponse }));

    await renderInteractive(audio);

    expect(audio.play).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
    expect(speechSynthesis.speak.mock.calls[0]?.[0]?.text).toBe(
      "请介绍一下你自己。"
    );
  });

  it("keeps the question readable when browser speech is unavailable", async () => {
    const audio = createAudioMock();
    vi.stubGlobal("window", {});
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn()
    });
    vi.stubGlobal("fetch", createFetchRouter({ speech: fallbackResponse }));

    const { renderer } = await renderInteractive(audio);
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain("请介绍一下你自己。");
    expect(text).toContain("语音不可用，请阅读题目");
  });

  it("aborts stale speech and interrupts the SDK when the question changes", async () => {
    const { audio } = setupInteractiveBrowser();
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/digital-human/sessions") {
        return sessionResponse("LINGMOU_CLOUD");
      }
      if (url.endsWith("/speech")) {
        const body = JSON.parse(String(init?.body));
        if (body.questionId === "question-1") {
          firstSignal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => {
            firstSignal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          });
        }
        return pcmResponse([[2, 0]]);
      }
      if (url.endsWith("/heartbeat")) return Response.json({ ok: true });
      if (init?.method === "DELETE") return Response.json({ ok: true });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { renderer } = await renderInteractive(audio);

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="下一道题。"
          sessionId="training-session-1"
          questionId="question-2"
        />
      );
    });
    await flushEffects();

    expect(firstSignal?.aborted).toBe(true);
    expect(lingmou.client.interrupt).toHaveBeenCalled();
    expect(lingmou.client.pushPcm).toHaveBeenCalledWith(
      Int16Array.from([2]),
      true
    );
  });

  it("ignores an old cloud reader failure after the next question is active", async () => {
    const { audio } = setupInteractiveBrowser();
    let oldController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/digital-human/sessions") {
          return sessionResponse("LINGMOU_CLOUD");
        }
        if (url.endsWith("/speech")) {
          const body = JSON.parse(String(init?.body)) as { questionId: string };
          if (body.questionId === "question-1") {
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  oldController = controller;
                }
              })
            );
          }
          return pcmResponse([[9, 0]]);
        }
        if (url.endsWith("/heartbeat")) return Response.json({ ok: true });
        if (init?.method === "DELETE") return Response.json({ ok: true });
        throw new Error(`Unexpected request ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const { renderer } = await renderInteractive(audio);
    expect(oldController).toBeDefined();

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="下一道题。"
          sessionId="training-session-1"
          questionId="question-2"
        />
      );
    });
    await flushEffects();

    expect(lingmou.client.pushPcm).toHaveBeenCalledWith(
      Int16Array.from([9]),
      true
    );
    const interruptCount = lingmou.client.interrupt.mock.calls.length;

    await act(async () => {
      oldController?.error(new Error("old stream failed"));
      await Promise.resolve();
    });
    await flushEffects();

    expect(lingmou.client.interrupt).toHaveBeenCalledTimes(interruptCount);
    expect(
      renderer.root.findAll(
        (node) => node.props["data-testid"] === "local-avatar-fallback"
      )
    ).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain(
      "数字人画面已降级"
    );
  });

  it("does not auto-replay the same question id but allows explicit replay", async () => {
    const { audio } = setupInteractiveBrowser();
    const fetchMock = createFetchRouter();
    vi.stubGlobal("fetch", fetchMock);
    const { renderer } = await renderInteractive(audio);
    const speechCalls = () => fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/speech")
    ).length;

    expect(speechCalls()).toBe(1);
    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="请介绍一下你自己。"
          sessionId="training-session-1"
          questionId="question-1"
        />
      );
    });
    await flushEffects();
    expect(speechCalls()).toBe(1);

    await act(async () => {
      findReplayButton(renderer).props.onClick();
    });
    await flushEffects();
    expect(speechCalls()).toBe(2);
  });

  it("heartbeats active sessions and exits with a keepalive DELETE on unmount", async () => {
    vi.useFakeTimers();
    const { audio } = setupInteractiveBrowser();
    const fetchMock = createFetchRouter({ mode: "LINGMOU_CLOUD" });
    vi.stubGlobal("fetch", fetchMock);
    const { renderer } = await renderInteractive(audio);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/digital-human/sessions/digital-session-1/heartbeat",
      expect.objectContaining({ method: "POST" })
    );

    await act(async () => renderer.unmount());
    mountedRenderers.splice(mountedRenderers.indexOf(renderer), 1);

    expect(lingmou.client.exit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/digital-human/sessions/digital-session-1",
      expect.objectContaining({ method: "DELETE", keepalive: true })
    );
  });

  it("owns one session across React StrictMode replay and cleans it once on unmount", async () => {
    vi.useFakeTimers();
    const { audio } = setupInteractiveBrowser();
    const fetchMock = createFetchRouter({ mode: "LINGMOU_CLOUD" });
    vi.stubGlobal("fetch", fetchMock);
    const avatarRoot = {} as HTMLVideoElement;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        <React.StrictMode>
          <DigitalInterviewerVideo
            interviewerName="AI 面试官"
            stage="正式面试"
            prompt="请介绍一下你自己。"
            sessionId="training-session-strict"
            questionId="question-strict"
          />
        </React.StrictMode>,
        {
          createNodeMock: (element) => {
            if (element.type === "audio") return audio;
            if (
              (element.props as Record<string, unknown>)["data-testid"] ===
              "lingmou-avatar-root"
            ) {
              return avatarRoot;
            }
            return null;
          },
          unstable_strictMode: true
        } as Parameters<typeof TestRenderer.create>[1] & {
          unstable_strictMode: boolean;
        }
      );
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    const mounted = renderer as ReactTestRenderer | null;
    if (!mounted) throw new Error("Strict renderer was not created");

    const createCalls = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/digital-human/sessions" &&
          (init as RequestInit | undefined)?.method === "POST"
      );
    const deleteCalls = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) ===
            "/api/digital-human/sessions/digital-session-1" &&
          (init as RequestInit | undefined)?.method === "DELETE"
      );

    expect(createCalls()).toHaveLength(1);
    expect(deleteCalls()).toHaveLength(0);
    expect(lingmou.createClient).toHaveBeenCalledOnce();
    expect(lingmou.client.start).toHaveBeenCalledOnce();

    await act(async () => {
      mounted.unmount();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(lingmou.client.exit).toHaveBeenCalledOnce();
    expect(deleteCalls()).toHaveLength(1);
  });

  it("waits for the new owner before auto-playing after session A changes to B", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    const clientA = {
      start: vi.fn(async (): Promise<void> => undefined),
      pushPcm: vi.fn(),
      interrupt: vi.fn(),
      exit: vi.fn()
    };
    let resolveClientB: (() => void) | undefined;
    const clientB = {
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveClientB = resolve;
          })
      ),
      pushPcm: vi.fn(),
      interrupt: vi.fn(),
      exit: vi.fn()
    };
    lingmou.createClient
      .mockResolvedValueOnce(clientA)
      .mockResolvedValueOnce(clientB);

    let lateAController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    let aSpeechCount = 0;
    const sessionFor = (id: "A" | "B") =>
      Response.json(
        {
          session: {
            id: `digital-session-${id}`,
            mode: "LINGMOU_CLOUD",
            status: "READY",
            reasonCode: null,
            connection: {
              ...connection,
              sessionId: `provider-session-${id}`
            },
            expiresAt: "2026-07-18T01:00:00.000Z"
          }
        },
        { status: 201 }
      );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/digital-human/sessions" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            trainingSessionId: string;
          };
          return sessionFor(
            body.trainingSessionId === "training-session-A" ? "A" : "B"
          );
        }
        if (url === "/api/digital-human/sessions/digital-session-A/speech") {
          aSpeechCount += 1;
          if (aSpeechCount === 1) {
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  lateAController = controller;
                }
              })
            );
          }
          return pcmResponse([[1, 0]]);
        }
        if (url === "/api/digital-human/sessions/digital-session-B/speech") {
          return pcmResponse([[2, 0]]);
        }
        if (url.endsWith("/heartbeat") && init?.method === "POST") {
          return Response.json({ ok: true });
        }
        if (init?.method === "DELETE") return Response.json({ ok: true });
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const { renderer } = await renderInteractive(audio, {
      sessionId: "training-session-A",
      questionId: "question-A",
      prompt: "A question"
    });
    expect(lateAController).toBeDefined();

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="B question"
          sessionId="training-session-B"
          questionId="question-B"
        />
      );
    });
    await flushEffects();

    const speechCallsFor = (id: "A" | "B") =>
      fetchMock.mock.calls.filter(([url, init]) => {
        if (
          String(url) !==
          `/api/digital-human/sessions/digital-session-${id}/speech`
        ) {
          return false;
        }
        return (init as RequestInit | undefined)?.method === "POST";
      });
    const deleteCallsFor = (id: "A" | "B") =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) ===
            `/api/digital-human/sessions/digital-session-${id}` &&
          (init as RequestInit | undefined)?.method === "DELETE"
      );

    expect(clientB.start).toHaveBeenCalledOnce();
    expect(speechCallsFor("A")).toHaveLength(1);
    expect(speechCallsFor("B")).toHaveLength(0);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(clientA.exit).toHaveBeenCalledOnce();
    expect(deleteCallsFor("A")).toHaveLength(1);

    await act(async () => {
      resolveClientB?.();
      await Promise.resolve();
    });
    await flushEffects();

    expect(speechCallsFor("A")).toHaveLength(1);
    expect(speechCallsFor("B")).toHaveLength(1);
    expect(
      JSON.parse(String(speechCallsFor("B")[0]?.[1]?.body))
    ).toMatchObject({ questionId: "question-B", text: "B question" });
    expect(clientB.pushPcm).toHaveBeenCalledWith(Int16Array.from([2]), true);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();

    const bInterruptCount = clientB.interrupt.mock.calls.length;
    await act(async () => {
      lateAController?.error(new Error("late A stream error"));
      await Promise.resolve();
    });
    await flushEffects();

    expect(speechCallsFor("B")).toHaveLength(1);
    expect(clientB.interrupt).toHaveBeenCalledTimes(bInterruptCount);
    expect(
      renderer.root.findAll(
        (node) => node.props["data-testid"] === "local-avatar-fallback"
      )
    ).toHaveLength(0);

    await act(async () => {
      renderer.unmount();
      await Promise.resolve();
    });
    mountedRenderers.splice(mountedRenderers.indexOf(renderer), 1);

    expect(clientA.exit).toHaveBeenCalledOnce();
    expect(deleteCallsFor("A")).toHaveLength(1);
    expect(clientB.exit).toHaveBeenCalledOnce();
    expect(deleteCallsFor("B")).toHaveLength(1);
  });

  it("ignores a successful downgrade for owner A after owner B replaces it", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    const clientA = {
      start: vi.fn(async (): Promise<void> => undefined),
      pushPcm: vi.fn(() => { throw new Error("A push failed"); }),
      interrupt: vi.fn(),
      exit: vi.fn()
    };
    const clientB = {
      start: vi.fn(async (): Promise<void> => undefined),
      pushPcm: vi.fn(),
      interrupt: vi.fn(),
      exit: vi.fn()
    };
    lingmou.createClient
      .mockResolvedValueOnce(clientA)
      .mockResolvedValueOnce(clientB);
    let resolveDowngrade!: (response: Response) => void;
    const pendingDowngrade = new Promise<Response>((resolve) => {
      resolveDowngrade = resolve;
    });
    const speechCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/digital-human/sessions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { trainingSessionId: string };
        const suffix = body.trainingSessionId.endsWith("A") ? "A" : "B";
        return Response.json({
          session: {
            id: `digital-session-${suffix}`,
            mode: "LINGMOU_CLOUD",
            status: "READY",
            reasonCode: null,
            connection: { ...connection, sessionId: `provider-session-${suffix}` },
            expiresAt: "2026-07-18T01:00:00.000Z"
          }
        }, { status: 201 });
      }
      if (url.endsWith("/speech")) {
        speechCalls.push(url);
        return pcmResponse([[1, 0]]);
      }
      if (url === "/api/digital-human/sessions/digital-session-A/downgrade") {
        return pendingDowngrade;
      }
      if (url.endsWith("/heartbeat")) return Response.json({ ok: true });
      if (init?.method === "DELETE") return Response.json({ ok: true });
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { renderer } = await renderInteractive(audio, {
      sessionId: "training-session-A",
      questionId: "question-A",
      prompt: "A question"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/digital-human/sessions/digital-session-A/downgrade",
      expect.objectContaining({ method: "POST" })
    ));

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="B question"
          sessionId="training-session-B"
          questionId="question-B"
        />
      );
    });
    await flushEffects();
    expect(clientB.pushPcm).toHaveBeenCalledOnce();

    await act(async () => {
      resolveDowngrade(Response.json({
        session: {
          id: "digital-session-A",
          mode: "LOCAL_AVATAR",
          status: "READY",
          reasonCode: "CLIENT_PCM_PUSH_FAILED",
          connection: null,
          expiresAt: "2026-07-18T01:00:00.000Z"
        }
      }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(clientB.pushPcm).toHaveBeenCalledOnce();
    expect(speechCalls.filter((url) => url.includes("digital-session-A"))).toHaveLength(1);
    expect(speechCalls.filter((url) => url.includes("digital-session-B"))).toHaveLength(1);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/digital-human/sessions/digital-session-A" &&
        (init as RequestInit | undefined)?.method === "DELETE"
    )).toHaveLength(1);
    expect(renderer.root.findAll(
      (node) => node.props["data-testid"] === "local-avatar-fallback"
    )).toHaveLength(0);
  });

  it("ignores a failed downgrade for owner A after owner B replaces it", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    const clientA = {
      start: vi.fn(async (): Promise<void> => undefined),
      pushPcm: vi.fn(() => { throw new Error("A push failed"); }),
      interrupt: vi.fn(),
      exit: vi.fn()
    };
    const clientB = {
      start: vi.fn(async (): Promise<void> => undefined),
      pushPcm: vi.fn(),
      interrupt: vi.fn(),
      exit: vi.fn()
    };
    lingmou.createClient
      .mockResolvedValueOnce(clientA)
      .mockResolvedValueOnce(clientB);
    let resolveDowngrade!: (response: Response) => void;
    const pendingDowngrade = new Promise<Response>((resolve) => {
      resolveDowngrade = resolve;
    });
    const speechCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/digital-human/sessions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { trainingSessionId: string };
        const suffix = body.trainingSessionId.endsWith("A") ? "A" : "B";
        return Response.json({
          session: {
            id: `digital-session-${suffix}`,
            mode: "LINGMOU_CLOUD",
            status: "READY",
            reasonCode: null,
            connection: { ...connection, sessionId: `provider-session-${suffix}` },
            expiresAt: "2026-07-18T01:00:00.000Z"
          }
        }, { status: 201 });
      }
      if (url.endsWith("/speech")) {
        speechCalls.push(url);
        return pcmResponse([[2, 0]]);
      }
      if (url === "/api/digital-human/sessions/digital-session-A/downgrade") {
        return pendingDowngrade;
      }
      if (url.endsWith("/heartbeat")) return Response.json({ ok: true });
      if (init?.method === "DELETE") return Response.json({ ok: true });
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { renderer } = await renderInteractive(audio, {
      sessionId: "training-session-A",
      questionId: "question-A",
      prompt: "A question"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/digital-human/sessions/digital-session-A/downgrade",
      expect.objectContaining({ method: "POST" })
    ));

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="B question"
          sessionId="training-session-B"
          questionId="question-B"
        />
      );
    });
    await flushEffects();
    expect(clientB.pushPcm).toHaveBeenCalledOnce();

    await act(async () => {
      resolveDowngrade(Response.json(
        { reasonCode: "DIGITAL_HUMAN_DOWNGRADE_FAILED" },
        { status: 503 }
      ));
      await Promise.resolve();
    });
    await flushEffects();

    expect(clientB.pushPcm).toHaveBeenCalledOnce();
    expect(speechCalls.filter((url) => url.includes("digital-session-A"))).toHaveLength(1);
    expect(speechCalls.filter((url) => url.includes("digital-session-B"))).toHaveLength(1);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/digital-human/sessions/digital-session-A" &&
        (init as RequestInit | undefined)?.method === "DELETE"
    )).toHaveLength(0);
    expect(renderer.root.findAll(
      (node) => node.props["data-testid"] === "local-avatar-fallback"
    )).toHaveLength(0);
  });

  it("does not create a paid session for the waiting-room preview", async () => {
    const { audio } = setupInteractiveBrowser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await renderInteractive(audio, { sessionId: undefined, questionId: undefined });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lingmou.createClient).not.toHaveBeenCalled();
  });

  it("stops provider audio and browser speech before another output", () => {
    const audio = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      currentTime: 8
    } as unknown as HTMLAudioElement;
    const speechSynthesis = { cancel: vi.fn() } as unknown as SpeechSynthesis;
    const revokeObjectUrl = vi.fn();

    stopInterviewerSpeech(
      audio,
      speechSynthesis,
      "blob:interviewer-audio",
      revokeObjectUrl
    );

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:interviewer-audio");
  });

  it("passes immutable question ids from the interview room", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/practice/InterviewRoom.tsx"),
      "utf8"
    );

    expect(source).toContain("sessionId={storedSession.sessionId}");
    expect(source).toContain(
      'questionId={activeFollowUp ? `${currentQuestion.id}::follow-up::1` : currentQuestion.id}'
    );
  });
});

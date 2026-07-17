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
    start: vi.fn(async () => undefined),
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
  const avatarRoot = {} as HTMLElement;
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
    expect(markup).toContain("灵眸真实数字人 / 本地数字人降级");
    expect(markup).toContain("CosyVoice / 浏览器语音降级");
    expect(markup).toContain("AI 生成数字人");
    expect(markup).toContain("请介绍项目经验。");
    expect(lingmou.createClient).not.toHaveBeenCalled();
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

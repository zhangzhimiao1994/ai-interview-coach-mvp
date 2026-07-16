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
      if (name === "src") {
        source = "";
      }
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

function apiResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: vi.fn(async () => payload)
  } as unknown as Response;
}

function findPlayButton(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("button")[0] as ReactTestInstance;
}

const mountedRenderers: ReactTestRenderer[] = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const renderer of mountedRenderers.splice(0)) {
      renderer.unmount();
    }
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setupInteractiveBrowser(audio = createAudioMock()) {
  const speechSynthesis = {
    cancel: vi.fn(),
    pause: vi.fn(),
    speak: vi.fn()
  };
  const createObjectURL = vi.fn(() => "blob:interviewer-audio");
  const revokeObjectURL = vi.fn();

  vi.stubGlobal("window", {
    speechSynthesis,
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    atob: (value: string) => Buffer.from(value, "base64").toString("binary")
  });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

  return { audio, speechSynthesis, createObjectURL, revokeObjectURL };
}

async function renderInteractive(audio: HTMLAudioElement, prompt = "请介绍一下你自己。") {
  let renderer: ReactTestRenderer | null = null;

  await act(async () => {
    renderer = TestRenderer.create(
      <DigitalInterviewerVideo
        interviewerName="AI 面试官"
        stage="正式面试"
        prompt={prompt}
        sessionId="session-1"
        questionId="question-1"
      />,
      {
        createNodeMock: (element) => element.type === "audio" ? audio : null
      }
    );
  });

  const mounted = renderer as ReactTestRenderer | null;
  if (!mounted) {
    throw new Error("Interactive renderer was not created");
  }
  mountedRenderers.push(mounted);
  return mounted;
}

describe("DigitalInterviewerVideo", () => {
  it("renders a video-first digital interviewer surface", () => {
    const markup = renderToStaticMarkup(
      <DigitalInterviewerVideo
        interviewerName="林夏"
        stage="正式面试"
        prompt="请你先用两分钟介绍一下自己，并说明为什么适合这个岗位。"
        status="speaking"
        sessionId="session-1"
        questionId="question-1"
        expression="probing"
      />
    );

    expect(markup).toContain("数字人面试官");
    expect(markup).toContain("林夏");
    expect(markup).toContain("正式面试");
    expect(markup).toContain("正在提问");
    expect(markup).toContain("摄像头已连接");
    expect(markup).toContain("语音字幕");
    expect(markup).toContain("阿里真实语音");
    expect(markup).toContain("浏览器语音降级");
    expect(markup).toContain("播放问题");
    expect(markup).toContain("暂停朗读");
    expect(markup).toContain("重播");
    expect(markup).toContain("<audio");
    expect(markup).toContain("数字面试官语音播放器");
    expect(markup).toContain("请你先用两分钟介绍一下自己");
    expect(markup).toContain("aria-label=\"数字人视频面试画面\"");
  });

  it("stops provider audio and browser speech before starting another output", () => {
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

  it("passes the active session and question context from the interview room", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/practice/InterviewRoom.tsx"),
      "utf8"
    );

    expect(source).toContain("sessionId={storedSession.sessionId}");
    expect(source).toContain('questionId={activeFollowUp ? `${currentQuestion.id}::follow-up::1` : currentQuestion.id}');
    expect(source).toContain('expression={activeFollowUp ? "probing" : "neutral"}');
  });

  it("plays provider audio without starting browser speech", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => apiResponse({
      mode: "ALIBABA_TTS",
      speech: {
        audioUrl: "https://dashscope-result.oss-cn-beijing.aliyuncs.com/question.wav",
        mimeType: "audio/wav"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderInteractive(audio);

    await act(async () => {
      await findPlayButton(renderer).props.onClick();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      sessionId: "session-1",
      questionId: "question-1",
      expression: "neutral"
    });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.src).toContain("question.wav");
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("uses browser speech only after the API explicitly falls back", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    vi.stubGlobal("fetch", vi.fn(async () => apiResponse({
      mode: "BROWSER_TTS_FALLBACK",
      speech: { audioUrl: null }
    })));
    const renderer = await renderInteractive(audio);

    await act(async () => {
      await findPlayButton(renderer).props.onClick();
    });

    expect(audio.play).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
    expect(String(speechSynthesis.speak.mock.calls[0]?.[0]?.text)).toBe("请介绍一下你自己。");
  });

  it("ignores a stale failed request after a rapid replay starts newer audio", async () => {
    const { audio, speechSynthesis } = setupInteractiveBrowser();
    let rejectFirst: ((reason?: unknown) => void) | null = null;
    const firstRequest = new Promise<Response>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce(apiResponse({
        mode: "ALIBABA_TTS",
        speech: { audioUrl: "https://example.aliyuncs.com/new.wav" }
      }));
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await renderInteractive(audio);
    let stalePlayback: Promise<void> | null = null;

    await act(async () => {
      stalePlayback = findPlayButton(renderer).props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      await findPlayButton(renderer).props.onClick();
    });
    const cancelCountAfterNewPlayback = speechSynthesis.cancel.mock.calls.length;
    await act(async () => {
      const rejectStale = rejectFirst as ((reason?: unknown) => void) | null;
      rejectStale?.(new Error("old request failed late"));
      await stalePlayback;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audio.src).toContain("new.wav");
    expect(audio.play).toHaveBeenCalledOnce();
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(cancelCountAfterNewPlayback);
  });

  it("revokes generated audio as soon as playback ends", async () => {
    const { audio, createObjectURL, revokeObjectURL } = setupInteractiveBrowser();
    vi.stubGlobal("fetch", vi.fn(async () => apiResponse({
      mode: "ALIBABA_TTS",
      speech: {
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav"
      }
    })));
    const renderer = await renderInteractive(audio);

    await act(async () => {
      await findPlayButton(renderer).props.onClick();
    });
    expect(createObjectURL).toHaveBeenCalledOnce();

    const audioElement = renderer.root.findByType("audio");
    await act(async () => {
      audioElement.props.onEnded({ currentTarget: audio });
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:interviewer-audio");
    expect(audio.src).toBe("");
  });

  it("cancels and revokes active audio on prompt change and unmount", async () => {
    const { audio, createObjectURL, revokeObjectURL } = setupInteractiveBrowser();
    createObjectURL
      .mockReturnValueOnce("blob:first-question")
      .mockReturnValueOnce("blob:second-question");
    vi.stubGlobal("fetch", vi.fn(async () => apiResponse({
      mode: "ALIBABA_TTS",
      speech: {
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav"
      }
    })));
    const renderer = await renderInteractive(audio);

    await act(async () => {
      await findPlayButton(renderer).props.onClick();
    });
    expect(audio.src).toBe("blob:first-question");

    await act(async () => {
      renderer.update(
        <DigitalInterviewerVideo
          interviewerName="AI 面试官"
          stage="正式面试"
          prompt="这是下一道题。"
          sessionId="session-1"
          questionId="question-2"
        />
      );
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-question");

    await act(async () => {
      await findPlayButton(renderer).props.onClick();
    });
    expect(audio.src).toBe("blob:second-question");

    await act(async () => {
      renderer.unmount();
    });
    mountedRenderers.splice(mountedRenderers.indexOf(renderer), 1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second-question");
    expect(audio.pause).toHaveBeenCalled();
  });
});

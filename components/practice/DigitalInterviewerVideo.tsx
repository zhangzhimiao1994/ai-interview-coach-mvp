"use client";

import { Camera, Mic, Pause, Radio, RotateCcw, Volume2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

type InterviewerExpression =
  | "neutral"
  | "encouraging"
  | "listening"
  | "probing"
  | "skeptical"
  | "serious"
  | "summary";

type DigitalInterviewerVideoProps = {
  interviewerName: string;
  stage: string;
  prompt: string;
  status?: "ready" | "speaking" | "listening";
  compact?: boolean;
  sessionId?: string;
  questionId?: string;
  expression?: InterviewerExpression;
};

type SpeechState =
  | "idle"
  | "loading"
  | "speaking"
  | "paused"
  | "unsupported";

type SpeechMode = "ALIBABA_TTS" | "BROWSER_TTS_FALLBACK" | null;

type SpeechApiPayload = {
  mode?: string;
  speech?: {
    audioUrl?: unknown;
    audioBase64?: unknown;
    mimeType?: unknown;
  };
};

const statusText = {
  ready: "候场中",
  speaking: "正在提问",
  listening: "等待回答"
};

function canUseSpeechSynthesis() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function browserSpeechSynthesis() {
  return canUseSpeechSynthesis() ? window.speechSynthesis : null;
}

function revokeBrowserObjectUrl(value: string) {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(value);
  }
}

export function createInterviewerPlaybackGuard() {
  let currentGeneration = 0;

  return {
    begin() {
      currentGeneration += 1;
      return currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
      return currentGeneration;
    },
    isCurrent(generation: number) {
      return generation === currentGeneration;
    }
  };
}

export function stopInterviewerSpeech(
  audio: HTMLAudioElement | null,
  speechSynthesis: SpeechSynthesis | null,
  objectUrl: string | null,
  revokeObjectUrl: (value: string) => void = revokeBrowserObjectUrl
) {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.currentTime = 0;
    audio.load();
  }

  speechSynthesis?.cancel();

  if (objectUrl) {
    revokeObjectUrl(objectUrl);
  }
}

function promptLanguage(prompt: string) {
  return /[a-zA-Z]/.test(prompt) && !/[\u4e00-\u9fa5]/.test(prompt)
    ? "en-US"
    : "zh-CN";
}

function createAudioObjectUrl(audioBase64: string, mimeType: string) {
  if (
    typeof window === "undefined" ||
    typeof window.atob !== "function" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const decoded = window.atob(audioBase64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function caughtErrorName(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : "";
}

export function DigitalInterviewerVideo({
  interviewerName,
  stage,
  prompt,
  status = "speaking",
  compact = false,
  sessionId,
  questionId,
  expression = "neutral"
}: DigitalInterviewerVideoProps) {
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [speechMode, setSpeechMode] = useState<SpeechMode>(null);
  const [speechMessage, setSpeechMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const providerAudioActiveRef = useRef(false);
  const activeAudioGenerationRef = useRef<number | null>(null);
  const activeAudioSourceRef = useRef<string | null>(null);
  const playbackGuardRef = useRef<ReturnType<typeof createInterviewerPlaybackGuard> | null>(null);
  if (!playbackGuardRef.current) {
    playbackGuardRef.current = createInterviewerPlaybackGuard();
  }
  const playbackGuard = playbackGuardRef.current;
  const displayStatus = speechState === "speaking" ? "speaking" : status;

  const stopSpeech = useCallback((resetState: boolean) => {
    const generation = playbackGuard.invalidate();
    abortRef.current?.abort();
    abortRef.current = null;
    providerAudioActiveRef.current = false;
    activeAudioGenerationRef.current = null;
    activeAudioSourceRef.current = null;
    utteranceRef.current = null;
    stopInterviewerSpeech(
      audioRef.current,
      browserSpeechSynthesis(),
      objectUrlRef.current
    );
    objectUrlRef.current = null;

    if (resetState) {
      setSpeechState("idle");
    }

    return generation;
  }, [playbackGuard]);

  useEffect(() => {
    stopSpeech(true);
    setSpeechMode(null);
    setSpeechMessage("");

    return () => {
      stopSpeech(false);
    };
  }, [prompt, questionId, sessionId, expression, stopSpeech]);

  function speakWithBrowser(message: string) {
    const generation = stopSpeech(false);

    if (!canUseSpeechSynthesis()) {
      if (playbackGuard.isCurrent(generation)) {
        setSpeechState("unsupported");
        setSpeechMode("BROWSER_TTS_FALLBACK");
        setSpeechMessage("当前浏览器不支持语音合成，请阅读屏幕上的问题。");
      }
      return;
    }

    const utterance = new SpeechSynthesisUtterance(prompt);
    utterance.lang = promptLanguage(prompt);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (playbackGuard.isCurrent(generation) && utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeechState("idle");
        setSpeechMessage("浏览器语音播放完成。");
      }
    };
    utterance.onerror = () => {
      if (playbackGuard.isCurrent(generation) && utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeechState("unsupported");
        setSpeechMessage("浏览器语音播放失败，请阅读屏幕上的问题。");
      }
    };

    utteranceRef.current = utterance;
    try {
      window.speechSynthesis.speak(utterance);
      if (playbackGuard.isCurrent(generation)) {
        setSpeechMode("BROWSER_TTS_FALLBACK");
        setSpeechMessage(message);
        setSpeechState("speaking");
      }
    } catch {
      if (playbackGuard.isCurrent(generation)) {
        utteranceRef.current = null;
        setSpeechMode("BROWSER_TTS_FALLBACK");
        setSpeechState("unsupported");
        setSpeechMessage("浏览器语音播放失败，请阅读屏幕上的问题。");
      }
    }
  }

  async function playPrompt() {
    const currentAudio = audioRef.current;
    const activeGeneration = activeAudioGenerationRef.current;
    if (
      speechState === "paused" &&
      currentAudio &&
      activeGeneration !== null &&
      isCurrentProviderAudio(currentAudio)
    ) {
      try {
        await currentAudio.play();
        if (playbackGuard.isCurrent(activeGeneration)) {
          setSpeechState("speaking");
          setSpeechMessage("正在播放阿里真实语音。");
        }
      } catch {
        if (playbackGuard.isCurrent(activeGeneration)) {
          setSpeechMessage("真实语音已生成，但浏览器阻止了播放，请再次点击播放问题。");
        }
      }
      return;
    }

    const generation = stopSpeech(false);
    setSpeechMessage("");

    if (!sessionId) {
      speakWithBrowser("候场预览使用浏览器语音；进入面试后会优先使用阿里真实语音。");
      return;
    }

    if (!prompt.trim() || prompt.length > 600) {
      speakWithBrowser("问题文本不符合真实语音长度限制，已切换为浏览器语音降级。");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSpeechState("loading");

    try {
      const response = await fetch("/api/digital-human/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId,
          questionId,
          text: prompt,
          language: promptLanguage(prompt),
          speed: 0.95,
          expression
        })
      });
      const payload = (await response.json().catch(() => null)) as SpeechApiPayload | null;

      if (!playbackGuard.isCurrent(generation)) {
        return;
      }

      if (!response.ok || !payload) {
        throw new Error("TTS_REQUEST_FAILED");
      }

      if (payload.mode === "BROWSER_TTS_FALLBACK") {
        speakWithBrowser("阿里真实语音暂不可用，已切换为浏览器语音降级。");
        return;
      }

      const audioUrl =
        typeof payload.speech?.audioUrl === "string" && payload.speech.audioUrl
          ? payload.speech.audioUrl
          : null;
      const audioBase64 =
        typeof payload.speech?.audioBase64 === "string" && payload.speech.audioBase64
          ? payload.speech.audioBase64
          : null;
      const mimeType =
        typeof payload.speech?.mimeType === "string" && payload.speech.mimeType
          ? payload.speech.mimeType
          : "audio/wav";
      const objectUrl = audioBase64
        ? createAudioObjectUrl(audioBase64, mimeType)
        : null;
      const source = audioUrl || objectUrl;
      const audio = audioRef.current;

      if (!source || !audio) {
        if (objectUrl) {
          revokeBrowserObjectUrl(objectUrl);
        }
        throw new Error("TTS_AUDIO_MISSING");
      }

      objectUrlRef.current = objectUrl;
      providerAudioActiveRef.current = true;
      activeAudioGenerationRef.current = generation;
      audio.src = source;
      activeAudioSourceRef.current = audio.src;
      audio.currentTime = 0;
      audio.load();
      setSpeechMode("ALIBABA_TTS");
      setSpeechMessage("正在播放阿里真实语音。");
      await audio.play();
      if (playbackGuard.isCurrent(generation) && isCurrentProviderAudio(audio)) {
        setSpeechState("speaking");
      }
    } catch (error) {
      if (!playbackGuard.isCurrent(generation)) {
        return;
      }

      const errorName = caughtErrorName(error);
      if (errorName === "AbortError") {
        return;
      }
      if (
        errorName === "NotAllowedError" &&
        audioRef.current &&
        isCurrentProviderAudio(audioRef.current)
      ) {
        setSpeechState("paused");
        setSpeechMessage("真实语音已生成，但浏览器阻止了自动播放，请再次点击播放问题。");
        return;
      }

      speakWithBrowser("阿里真实语音暂不可用，已切换为浏览器语音降级。");
    } finally {
      if (playbackGuard.isCurrent(generation) && abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function pauseSpeech() {
    const audio = audioRef.current;
    if (providerAudioActiveRef.current && audio) {
      audio.pause();
      setSpeechState("paused");
      setSpeechMessage("阿里真实语音已暂停。");
      return;
    }

    if (canUseSpeechSynthesis() && utteranceRef.current) {
      window.speechSynthesis.pause();
      setSpeechState("paused");
      setSpeechMessage("浏览器语音已暂停。");
    }
  }

  function replaySpeech() {
    void playPrompt();
  }

  function isCurrentProviderAudio(audio: HTMLAudioElement) {
    const generation = activeAudioGenerationRef.current;
    const currentSource = audio.currentSrc || audio.src;

    return (
      providerAudioActiveRef.current &&
      generation !== null &&
      playbackGuard.isCurrent(generation) &&
      Boolean(activeAudioSourceRef.current) &&
      currentSource === activeAudioSourceRef.current
    );
  }

  function handleProviderAudioError(event: React.SyntheticEvent<HTMLAudioElement>) {
    if (!isCurrentProviderAudio(event.currentTarget)) {
      return;
    }

    speakWithBrowser("真实语音音频加载失败，已切换为浏览器语音降级。");
  }

  const modeText =
    speechState === "loading"
      ? "正在生成阿里真实语音"
      : speechMode === "ALIBABA_TTS"
        ? "阿里真实语音"
        : speechMode === "BROWSER_TTS_FALLBACK"
          ? "浏览器语音降级"
          : sessionId
            ? "阿里真实语音待播放"
            : "浏览器语音预览";

  return (
    <section
      aria-label="数字人视频面试画面"
      className="relative overflow-hidden rounded-lg border border-slate-800 bg-[#111827] text-white shadow-sm"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.22),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(5,150,105,0.18),transparent_30%),linear-gradient(135deg,#111827,#1f2937_48%,#0f172a)]" />
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/10 to-transparent" />
      <div className="relative grid min-h-[360px] gap-5 p-5 md:grid-cols-[1fr_280px]">
        <div className="flex min-h-[300px] flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-blue-100">数字人面试官</p>
              <h2 className="mt-1 text-xl font-semibold">{interviewerName}</h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-blue-50">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)]" />
              {statusText[displayStatus]}
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-sm flex-1 items-center justify-center py-5">
            <div className="relative aspect-[3/4] w-full max-w-[240px] rounded-[2rem] border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur">
              <div className="absolute -inset-3 rounded-[2.25rem] border border-blue-200/10" />
              <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[1.5rem] bg-gradient-to-b from-slate-200 to-slate-500">
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/45 to-transparent" />
                <div className="relative h-24 w-24 rounded-full bg-gradient-to-b from-[#f2d5bf] to-[#c9876a] shadow-lg">
                  <div className="absolute left-5 top-10 h-2 w-3 rounded-full bg-slate-800" />
                  <div className="absolute right-5 top-10 h-2 w-3 rounded-full bg-slate-800" />
                  <div className={speechState === "speaking" ? "absolute left-1/2 top-14 h-1.5 w-9 -translate-x-1/2 rounded-full bg-rose-700/70 digital-mouth" : "absolute left-1/2 top-14 h-1 w-8 -translate-x-1/2 rounded-full bg-rose-700/70"} />
                  <div className="absolute inset-x-3 -top-2 h-9 rounded-t-full bg-slate-900" />
                </div>
                <div className="mt-3 h-32 w-36 rounded-t-[3rem] bg-gradient-to-b from-slate-900 to-slate-700 shadow-xl" />
                <div className="absolute bottom-4 flex items-end gap-1" aria-hidden="true">
                  <span className={speechState === "speaking" ? "digital-wave h-4 w-1 rounded-full bg-emerald-200" : "h-4 w-1 rounded-full bg-emerald-200/50"} />
                  <span className={speechState === "speaking" ? "digital-wave h-8 w-1 rounded-full bg-emerald-200 [animation-delay:120ms]" : "h-8 w-1 rounded-full bg-emerald-200/50"} />
                  <span className={speechState === "speaking" ? "digital-wave h-5 w-1 rounded-full bg-emerald-200 [animation-delay:240ms]" : "h-5 w-1 rounded-full bg-emerald-200/50"} />
                  <span className={speechState === "speaking" ? "digital-wave h-10 w-1 rounded-full bg-emerald-200 [animation-delay:360ms]" : "h-10 w-1 rounded-full bg-emerald-200/50"} />
                  <span className={speechState === "speaking" ? "digital-wave h-6 w-1 rounded-full bg-emerald-200 [animation-delay:480ms]" : "h-6 w-1 rounded-full bg-emerald-200/50"} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-md border border-white/15 bg-black/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-100">
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                语音字幕
              </div>
              <div className="flex flex-wrap gap-2 text-xs" aria-label="数字面试官语音控制">
                <button
                  className="rounded-md bg-white/10 px-2 py-1 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  disabled={speechState === "loading" || !prompt.trim()}
                  onClick={playPrompt}
                >
                  {speechState === "loading" ? "生成真实语音中..." : "播放问题"}
                </button>
                <button className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 transition hover:bg-white/20" type="button" onClick={pauseSpeech}>
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  暂停朗读
                </button>
                <button className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 transition hover:bg-white/20" type="button" onClick={replaySpeech}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  重播
                </button>
              </div>
            </div>
            <audio
              ref={audioRef}
              aria-label="数字面试官语音播放器"
              className="sr-only"
              preload="none"
              onPlay={(event) => {
                if (isCurrentProviderAudio(event.currentTarget)) {
                  setSpeechState("speaking");
                }
              }}
              onPause={(event) => {
                if (isCurrentProviderAudio(event.currentTarget)) {
                  setSpeechState("paused");
                }
              }}
              onEnded={(event) => {
                if (!isCurrentProviderAudio(event.currentTarget)) {
                  return;
                }

                stopSpeech(false);
                setSpeechState("idle");
                setSpeechMessage("阿里真实语音播放完成。");
              }}
              onError={handleProviderAudioError}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-blue-100">
              <span className="rounded-full border border-emerald-200/30 bg-emerald-300/10 px-2 py-1">
                {modeText}
              </span>
              <span>阿里真实语音优先</span>
              <span aria-hidden="true">·</span>
              <span>浏览器语音降级可用</span>
            </div>
            <p className="text-base leading-7 text-white">{prompt}</p>
            {speechMessage ? <p className="text-xs text-amber-100">{speechMessage}</p> : null}
          </div>
        </div>

        <aside className="grid content-start gap-3 rounded-md border border-white/15 bg-white/10 p-4 text-sm backdrop-blur">
          <div>
            <p className="text-xs text-blue-100">当前阶段</p>
            <p className="mt-1 font-semibold">{stage}</p>
          </div>
          <StatusLine icon={<Camera className="h-4 w-4" aria-hidden="true" />} label="摄像头已连接" />
          <StatusLine icon={<Mic className="h-4 w-4" aria-hidden="true" />} label="麦克风待录入" />
          <StatusLine icon={<Radio className="h-4 w-4" aria-hidden="true" />} label="AI 追问引擎在线" />
          {!compact ? (
            <div className="mt-2 rounded-md bg-black/25 p-3 text-xs leading-5 text-blue-50">
              面试房间会优先请求已配置的阿里 TTS 真实语音；配置、网络或音频播放失败时，会明确切换为浏览器语音降级。
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function StatusLine({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-black/20 px-3 py-2 text-blue-50">
      {icon}
      <span>{label}</span>
    </div>
  );
}

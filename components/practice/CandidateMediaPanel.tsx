"use client";

import { Camera, Mic, MicOff, Play, Square, Video, VideoOff } from "lucide-react";
import React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ALIBABA_REALTIME_ASR,
  createAlibabaAsrClient,
  type AlibabaAsrClient
} from "@/lib/client/alibabaAsrClient";
import type { BehaviorSignals } from "@/lib/domain/behaviorSignals";

type CandidateMediaPanelProps = {
  sessionId: string;
  onTranscript: (text: string) => void;
  onBehaviorSignalsChange?: (signals: BehaviorSignals) => void;
  onSpeechActivityChange?: (activity: CandidateSpeechActivity) => void;
};

type MediaState = "idle" | "requesting" | "ready" | "blocked" | "unsupported";
export type CandidateSpeechActivity =
  | "idle"
  | "connecting"
  | "listening"
  | "stopping";
type SpeechState = CandidateSpeechActivity | "unsupported";
type SpeechProvider = "none" | "alibaba" | "browser";

type SpeechRecognitionEventLike = Event & {
  results: {
    length: number;
    [index: number]: {
      isFinal?: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function isLocalSecureOrigin() {
  if (typeof window === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };

  return maybeWindow.SpeechRecognition ?? maybeWindow.webkitSpeechRecognition ?? null;
}

function describeMediaError(error: unknown) {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Chrome 没有拿到摄像头或麦克风权限。请点地址栏左侧的站点设置，允许摄像头和麦克风后刷新页面再试。";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有检测到可用的摄像头或麦克风。请确认电脑已连接设备，并且系统隐私设置允许浏览器访问。";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "摄像头或麦克风可能正被其他软件占用。请关闭会议软件、录屏工具或系统相机后重试。";
  }

  if (name === "OverconstrainedError") {
    return "当前摄像头不支持请求的分辨率。请换一个摄像头，或稍后使用默认画质重试。";
  }

  return "没有成功连接摄像头或麦克风。请检查浏览器权限、系统隐私设置和设备连接后重试。";
}

export function CandidateMediaPanel({
  sessionId,
  onTranscript,
  onBehaviorSignalsChange,
  onSpeechActivityChange
}: CandidateMediaPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const alibabaClientRef = useRef<AlibabaAsrClient | null>(null);
  const stoppingClientRef = useRef<AlibabaAsrClient | null>(null);
  const speechRecognitionUsedRef = useRef(false);
  const volumeSamplesRef = useRef<number[]>([]);
  const peakVolumeRef = useRef(0);
  const longPauseCountRef = useRef(0);
  const quietStartedAtRef = useRef<number | null>(null);
  const lastSignalEmitRef = useRef(0);
  const [mediaState, setMediaState] = useState<MediaState>("idle");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [speechProvider, setSpeechProvider] = useState<SpeechProvider>("none");
  const [meter, setMeter] = useState(0);
  const [message, setMessage] = useState("请先开启权限，Chrome 会弹出电脑摄像头和麦克风授权。");

  useEffect(() => {
    return () => {
      void alibabaClientRef.current?.stop();
      alibabaClientRef.current = null;
      recognitionRef.current?.stop();
      recognitionRef.current = null;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    onSpeechActivityChange?.(
      speechState === "unsupported" ? "idle" : speechState
    );
  }, [onSpeechActivityChange, speechState]);

  async function startMedia() {
    if (typeof window !== "undefined" && !window.isSecureContext && !isLocalSecureOrigin()) {
      setMediaState("unsupported");
      setMessage(
        "当前页面不是安全来源，Chrome 不会开放摄像头和麦克风权限。请使用 HTTPS 公网地址，或在电脑本机打开 http://localhost:3000 调试。"
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaState("unsupported");
      setMessage("当前浏览器不支持摄像头/麦克风调用。请使用新版 Chrome、Edge 或 Safari，并通过 HTTPS 或 localhost 打开。");
      return;
    }

    await stopMedia();
    setMediaState("requesting");
    setMessage("正在请求电脑摄像头和麦克风权限...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setMediaState("ready");
      setMessage("摄像头和麦克风已连接。你可以开始模拟回答，手机访问时也会使用当前设备的摄像头和麦克风。");
      startAudioMeter(stream);
    } catch (error) {
      setMediaState("blocked");
      setMessage(describeMediaError(error));
    }
  }

  async function stopMedia() {
    await stopSpeech();

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMeter(0);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    volumeSamplesRef.current = [];
    peakVolumeRef.current = 0;
    longPauseCountRef.current = 0;
    quietStartedAtRef.current = null;
    emitBehaviorSignals(false);
  }

  function startAudioMeter(stream: MediaStream) {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const data = new Uint8Array(analyser.frequencyBinCount);

    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = audioContext;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      const normalizedVolume = Math.min(100, Math.round((average / 128) * 100));

      setMeter(normalizedVolume);
      volumeSamplesRef.current = [...volumeSamplesRef.current.slice(-60), normalizedVolume];
      peakVolumeRef.current = Math.max(peakVolumeRef.current, normalizedVolume);

      if (normalizedVolume < 8) {
        quietStartedAtRef.current ??= Date.now();
      } else if (quietStartedAtRef.current) {
        if (Date.now() - quietStartedAtRef.current >= 2000) {
          longPauseCountRef.current += 1;
        }
        quietStartedAtRef.current = null;
      }

      if (Date.now() - lastSignalEmitRef.current > 500) {
        lastSignalEmitRef.current = Date.now();
        emitBehaviorSignals(true);
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    tick();
  }

  function startBrowserSpeech() {
    const Recognition = getSpeechRecognitionConstructor();

    if (!Recognition) {
      setSpeechState("unsupported");
      setSpeechProvider("none");
      setMessage(
        "阿里实时识别暂不可用，当前浏览器也不支持浏览器识别降级。你仍可手动输入回答。"
      );
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) {
        return;
      }

      const text = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index]?.[0]?.transcript ?? "")
        .join("")
        .trim();

      if (text) {
        speechRecognitionUsedRef.current = true;
        onTranscript(text);
        emitBehaviorSignals(true);
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) {
        return;
      }
      recognitionRef.current = null;
      setSpeechState("idle");
      setSpeechProvider("none");
    };
    recognition.onerror = () => {
      if (recognitionRef.current !== recognition) {
        return;
      }
      recognitionRef.current = null;
      setSpeechState("idle");
      setSpeechProvider("none");
      setMessage("浏览器识别降级中断了。可以重新开始语音回答，或直接手动输入。");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setSpeechState("listening");
    setSpeechProvider("browser");
    speechRecognitionUsedRef.current = true;
    setMessage("阿里实时识别暂不可用，已切换为浏览器识别降级，结果会同步到回答框。");
  }

  async function startSpeech() {
    const stream = streamRef.current;
    if (!stream) {
      setMessage("请先开启摄像头和麦克风，再开始语音回答。");
      return;
    }

    setSpeechState("connecting");
    setSpeechProvider("none");
    setMessage("正在连接阿里实时识别服务...");

    const client = createAlibabaAsrClient({
      sessionId,
      stream,
      onPartial(text) {
        if (alibabaClientRef.current === client && text.trim()) {
          speechRecognitionUsedRef.current = true;
          onTranscript(text.trim());
        }
      },
      onFinal(text) {
        if (alibabaClientRef.current === client && text.trim()) {
          speechRecognitionUsedRef.current = true;
          onTranscript(text.trim());
          emitBehaviorSignals(true);
        }
      },
      onState(state) {
        if (alibabaClientRef.current !== client) {
          return;
        }
        if (state === "connecting") {
          setSpeechState("connecting");
        } else if (state === "listening") {
          setSpeechState("listening");
        } else {
          if (stoppingClientRef.current === client) {
            return;
          }
          alibabaClientRef.current = null;
          if (streamRef.current === stream) {
            startBrowserSpeech();
          }
        }
      },
      onError(errorMessage) {
        if (alibabaClientRef.current === client) {
          setMessage(errorMessage);
        }
      }
    });
    alibabaClientRef.current = client;

    try {
      await client.start();
      if (alibabaClientRef.current !== client) {
        await client.stop();
        return;
      }

      setSpeechState("listening");
      setSpeechProvider("alibaba");
      speechRecognitionUsedRef.current = true;
      setMessage("阿里实时识别已连接，转写结果会同步到回答框。");
    } catch {
      if (alibabaClientRef.current !== client) {
        return;
      }

      alibabaClientRef.current = null;
      await client.stop();
      startBrowserSpeech();
    }
  }

  async function stopSpeech() {
    const alibabaClient = alibabaClientRef.current;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.stop();

    if (alibabaClient) {
      stoppingClientRef.current = alibabaClient;
      setSpeechState("stopping");
      setMessage("正在完成最后一段转写，请稍候...");
      try {
        await alibabaClient.stop();
      } finally {
        if (stoppingClientRef.current === alibabaClient) {
          stoppingClientRef.current = null;
        }
        if (alibabaClientRef.current === alibabaClient) {
          alibabaClientRef.current = null;
        }
        setSpeechState("idle");
        setSpeechProvider("none");
        setMessage("语音回答已停止，最终转写已同步。");
      }
      return;
    }

    setSpeechState("idle");
    setSpeechProvider("none");
  }

  const mediaReady = mediaState === "ready";
  const mediaBlocked = mediaState === "blocked" || mediaState === "unsupported";

  function emitBehaviorSignals(readyOverride = mediaReady) {
    const samples = volumeSamplesRef.current;
    const averageVolume = samples.length
      ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
      : 0;

    onBehaviorSignalsChange?.({
      averageVolume,
      peakVolume: peakVolumeRef.current,
      longPauseCount: longPauseCountRef.current,
      cameraEnabled: readyOverride,
      microphoneEnabled: readyOverride,
      speechRecognitionUsed: speechRecognitionUsedRef.current
    });
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-sm" aria-label="电脑摄像头与麦克风">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">电脑摄像头与麦克风</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">视频预览</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
          {mediaReady ? (
            <Video className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {mediaReady ? "已连接" : mediaState === "requesting" ? "请求中" : "未连接"}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-slate-800 bg-slate-950">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
            aria-label="候选人视频预览"
          />
          {!mediaReady ? (
            <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-slate-200">
              开启后这里会显示当前摄像头画面
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <div className="rounded-md border border-line bg-white p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                {mediaReady ? (
                  <Mic className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <MicOff className="h-4 w-4 text-muted" aria-hidden="true" />
                )}
                麦克风电平
              </span>
              <span className="text-xs text-muted">{meter}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${meter}%` }} />
            </div>
          </div>

          <p className={mediaBlocked ? "text-sm leading-6 text-red-600" : "text-sm leading-6 text-muted"}>{message}</p>

          <div
            className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900"
            data-asr-mode={ALIBABA_REALTIME_ASR}
          >
            阿里实时识别优先；连接失败时会自动使用浏览器识别降级。
            {speechProvider === "alibaba"
              ? " 当前：阿里实时识别。"
              : speechProvider === "browser"
                ? " 当前：浏览器识别降级。"
                : ""}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              className="gap-2"
              disabled={mediaState === "requesting" || speechState === "stopping"}
              onClick={startMedia}
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              {mediaReady ? "重新检测设备" : "开启摄像头和麦克风"}
            </Button>
            <Button
              className="gap-2"
              disabled={!mediaReady || speechState === "stopping"}
              variant="secondary"
              onClick={
                speechState === "listening" || speechState === "connecting"
                  ? () => void stopSpeech()
                  : startSpeech
              }
            >
              {speechState === "listening" ||
              speechState === "connecting" ||
              speechState === "stopping" ? (
                <Square className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              {speechState === "stopping"
                ? "正在完成转写..."
                : speechState === "connecting"
                ? "取消识别连接"
                : speechState === "listening"
                  ? "停止语音回答"
                  : "开始语音回答"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

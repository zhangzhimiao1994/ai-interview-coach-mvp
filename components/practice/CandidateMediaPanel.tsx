"use client";

import { Camera, Mic, MicOff, Play, Square, Video, VideoOff } from "lucide-react";
import React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

type CandidateMediaPanelProps = {
  onTranscript: (text: string) => void;
};

type MediaState = "idle" | "requesting" | "ready" | "blocked" | "unsupported";
type SpeechState = "idle" | "listening" | "unsupported";

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

export function CandidateMediaPanel({ onTranscript }: CandidateMediaPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [mediaState, setMediaState] = useState<MediaState>("idle");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [meter, setMeter] = useState(0);
  const [message, setMessage] = useState("请先开启权限，手机浏览器会弹出摄像头和麦克风授权。");

  useEffect(() => {
    return () => {
      stopSpeech();
      stopMedia();
    };
  }, []);

  async function startMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaState("unsupported");
      setMessage("当前浏览器不支持摄像头/麦克风调用，请使用手机 Chrome、Safari 或微信外部浏览器打开 HTTPS 地址。");
      return;
    }

    setMediaState("requesting");
    setMessage("正在请求摄像头和麦克风权限...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setMediaState("ready");
      setMessage("摄像头和麦克风已连接。你可以开始模拟回答。");
      startAudioMeter(stream);
    } catch {
      setMediaState("blocked");
      setMessage("没有拿到摄像头或麦克风权限。请在浏览器地址栏权限设置里允许后重试。");
    }
  }

  function stopMedia() {
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
      setMeter(Math.min(100, Math.round((average / 128) * 100)));
      animationRef.current = requestAnimationFrame(tick);
    };

    tick();
  }

  function startSpeech() {
    const Recognition = getSpeechRecognitionConstructor();

    if (!Recognition) {
      setSpeechState("unsupported");
      setMessage("当前浏览器不支持实时语音转文字。你仍然可以打开麦克风练习，并手动输入回答。");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const text = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index]?.[0]?.transcript ?? "")
        .join("")
        .trim();

      if (text) {
        onTranscript(text);
      }
    };
    recognition.onend = () => {
      setSpeechState("idle");
    };
    recognition.onerror = () => {
      setSpeechState("idle");
      setMessage("语音识别中断了，可以重新开始语音回答，或直接手动输入。");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setSpeechState("listening");
    setMessage("正在听取你的回答，识别结果会同步到回答框。");
  }

  function stopSpeech() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setSpeechState("idle");
  }

  const mediaReady = mediaState === "ready";
  const mediaBlocked = mediaState === "blocked" || mediaState === "unsupported";

  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-sm" aria-label="手机摄像头和麦克风">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">手机摄像头和麦克风</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">自拍视频预览</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
          {mediaReady ? <Video className="h-3.5 w-3.5" aria-hidden="true" /> : <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />}
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
            aria-label="候选人自拍视频预览"
          />
          {!mediaReady ? (
            <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-slate-200">
              开启后这里会显示你的手机前置摄像头画面
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <div className="rounded-md border border-line bg-white p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                {mediaReady ? <Mic className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <MicOff className="h-4 w-4 text-muted" aria-hidden="true" />}
                麦克风电平
              </span>
              <span className="text-xs text-muted">{meter}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${meter}%` }} />
            </div>
          </div>

          <p className={mediaBlocked ? "text-sm leading-6 text-red-600" : "text-sm leading-6 text-muted"}>{message}</p>

          <div className="flex flex-wrap gap-3">
            <Button className="gap-2" disabled={mediaState === "requesting"} onClick={startMedia}>
              <Camera className="h-4 w-4" aria-hidden="true" />
              {mediaReady ? "重新开启设备" : "开启摄像头和麦克风"}
            </Button>
            <Button
              className="gap-2"
              disabled={!mediaReady || speechState === "unsupported"}
              variant="secondary"
              onClick={speechState === "listening" ? stopSpeech : startSpeech}
            >
              {speechState === "listening" ? <Square className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {speechState === "listening" ? "停止语音回答" : "开始语音回答"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { Camera, Mic, Pause, Radio, RotateCcw, Volume2 } from "lucide-react";
import React, { useEffect, useState } from "react";

type DigitalInterviewerVideoProps = {
  interviewerName: string;
  stage: string;
  prompt: string;
  status?: "ready" | "speaking" | "listening";
  compact?: boolean;
};

const statusText = {
  ready: "候场中",
  speaking: "正在提问",
  listening: "等待回答"
};

function canUseSpeechSynthesis() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function DigitalInterviewerVideo({
  interviewerName,
  stage,
  prompt,
  status = "speaking",
  compact = false
}: DigitalInterviewerVideoProps) {
  const [speechState, setSpeechState] = useState<"idle" | "speaking" | "paused" | "unsupported">("idle");
  const displayStatus = speechState === "speaking" ? "speaking" : status;

  useEffect(() => {
    return () => {
      if (canUseSpeechSynthesis()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function speakPrompt(replay = false) {
    if (!canUseSpeechSynthesis()) {
      setSpeechState("unsupported");
      return;
    }

    if (replay) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(prompt);
    utterance.lang = /[a-zA-Z]/.test(prompt) && !/[\u4e00-\u9fa5]/.test(prompt) ? "en-US" : "zh-CN";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => setSpeechState("idle");
    utterance.onerror = () => setSpeechState("idle");

    window.speechSynthesis.speak(utterance);
    setSpeechState("speaking");
  }

  function pauseSpeech() {
    if (!canUseSpeechSynthesis()) {
      setSpeechState("unsupported");
      return;
    }

    window.speechSynthesis.pause();
    setSpeechState("paused");
  }

  function replaySpeech() {
    speakPrompt(true);
  }

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
              <div className="flex flex-wrap gap-2 text-xs" aria-label="浏览器语音控制">
                <button className="rounded-md bg-white/10 px-2 py-1 transition hover:bg-white/20" type="button" onClick={() => speakPrompt()}>
                  浏览器语音 · 朗读问题
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
            <p className="text-base leading-7 text-white">{prompt}</p>
            {speechState === "unsupported" ? (
              <p className="text-xs text-amber-100">当前浏览器不支持内置语音合成，可接入后台 TTS 接口返回真实音频。</p>
            ) : null}
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
              当前版本使用浏览器语音合成和状态化头像。后台已预留 TTS、数字人视频渲染和行为分析接口，可替换为真实服务商。
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

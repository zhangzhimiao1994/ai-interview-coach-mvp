"use client";

import { Camera, Mic, Pause, Radio, RotateCcw, Volume2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createLingmouAvatarClient,
  type LingmouAvatarClient,
  type LingmouRtcConnection
} from "@/lib/client/lingmouAvatarClient";
import { Pcm16LeDecoder, pcm16LeToWavBlob } from "@/lib/client/pcm16";

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

type SpeechState = "idle" | "loading" | "speaking" | "paused" | "unsupported";
type SpeechMode = "COSYVOICE" | "BROWSER_TTS_FALLBACK" | null;
type AvatarMode = "CONNECTING" | "LINGMOU_CLOUD" | "LOCAL_AVATAR";

type PublicDigitalHumanSession = {
  id: string;
  mode: "LINGMOU_CLOUD" | "LOCAL_AVATAR";
  status: "READY";
  reasonCode: string | null;
  connection: LingmouRtcConnection | null;
  expiresAt: string;
};

type DigitalHumanSessionActivation = {
  session: PublicDigitalHumanSession;
  avatarClient: LingmouAvatarClient | null;
  avatarMode: "LINGMOU_CLOUD" | "LOCAL_AVATAR";
  avatarMessage: string;
};

type DigitalHumanSessionOwnership = {
  trainingSessionId: string;
  controller: AbortController;
  promise: Promise<DigitalHumanSessionActivation>;
  session: PublicDigitalHumanSession | null;
  avatarClient: LingmouAvatarClient | null;
  lease: number;
  finalized: boolean;
  deleteRequested: boolean;
  recoveryOwnedByServer: boolean;
  downgradePromise: Promise<PublicDigitalHumanSession> | null;
};

const statusText = {
  ready: "候场中",
  speaking: "正在提问",
  listening: "等待回答"
};

function canUseSpeechSynthesis() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
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
  if (objectUrl) revokeObjectUrl(objectUrl);
}

function promptLanguage(prompt: string) {
  return /[a-zA-Z]/.test(prompt) && !/[\u4e00-\u9fa5]/.test(prompt)
    ? "en-US"
    : "zh-CN";
}

function caughtErrorName(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : "";
}

function isDigitalHumanSession(value: unknown): value is PublicDigitalHumanSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<PublicDigitalHumanSession>;
  return (
    typeof session.id === "string" &&
    (session.mode === "LINGMOU_CLOUD" || session.mode === "LOCAL_AVATAR") &&
    session.status === "READY" &&
    typeof session.expiresAt === "string" &&
    (session.connection === null || typeof session.connection === "object")
  );
}

function deleteDigitalHumanSession(id: string) {
  if (typeof fetch !== "function") return;
  void fetch(`/api/digital-human/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: true
  }).catch(() => undefined);
}

function deleteOwnedDigitalHumanSession(owner: DigitalHumanSessionOwnership) {
  if (
    !owner.session ||
    owner.deleteRequested ||
    owner.recoveryOwnedByServer
  ) return;
  owner.deleteRequested = true;
  deleteDigitalHumanSession(owner.session.id);
}

function finalizeDigitalHumanSessionOwnership(
  owner: DigitalHumanSessionOwnership
) {
  if (owner.finalized) return;
  owner.finalized = true;
  owner.controller.abort();
  owner.avatarClient?.exit();
  owner.avatarClient = null;
  deleteOwnedDigitalHumanSession(owner);
}

export function DigitalInterviewerVideo({
  interviewerName,
  stage,
  prompt,
  status = "speaking",
  compact = false,
  sessionId,
  questionId
}: DigitalInterviewerVideoProps) {
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [speechMode, setSpeechMode] = useState<SpeechMode>(null);
  const [speechMessage, setSpeechMessage] = useState("");
  const [avatarMessage, setAvatarMessage] = useState("");
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(
    sessionId ? "CONNECTING" : "LOCAL_AVATAR"
  );
  const [cloudReady, setCloudReady] = useState(false);
  const [digitalSession, setDigitalSession] =
    useState<PublicDigitalHumanSession | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const avatarRootRef = useRef<HTMLVideoElement | null>(null);
  const avatarClientRef = useRef<LingmouAvatarClient | null>(null);
  const digitalSessionRef = useRef<PublicDigitalHumanSession | null>(null);
  const sessionOwnershipRef = useRef<DigitalHumanSessionOwnership | null>(null);
  const avatarModeRef = useRef<AvatarMode>(avatarMode);
  const abortRef = useRef<AbortController | null>(null);
  const heartbeatStopRef = useRef<(() => void) | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const providerAudioActiveRef = useRef(false);
  const activeAudioGenerationRef = useRef<number | null>(null);
  const activeAudioSourceRef = useRef<string | null>(null);
  const lastAutoPlayedRef = useRef<string | null>(null);
  const playbackGuardRef = useRef<ReturnType<typeof createInterviewerPlaybackGuard> | null>(null);
  if (!playbackGuardRef.current) {
    playbackGuardRef.current = createInterviewerPlaybackGuard();
  }
  const playbackGuard = playbackGuardRef.current;
  const displayStatus = speechState === "speaking" ? "speaking" : status;

  const setActiveAvatarMode = useCallback((mode: AvatarMode) => {
    avatarModeRef.current = mode;
    setAvatarMode(mode);
    setCloudReady(mode === "LINGMOU_CLOUD");
  }, []);

  const stopSpeech = useCallback(
    (resetState: boolean) => {
      const generation = playbackGuard.invalidate();
      abortRef.current?.abort();
      abortRef.current = null;
      avatarClientRef.current?.interrupt();
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
      if (resetState) setSpeechState("idle");
      return generation;
    },
    [playbackGuard]
  );

  const requestOwnedDowngrade = useCallback(
    (
      owner: DigitalHumanSessionOwnership,
      reasonCode: "CLIENT_SDK_INIT_FAILED" | "CLIENT_PCM_PUSH_FAILED"
    ) => {
      if (owner.downgradePromise) return owner.downgradePromise;
      heartbeatStopRef.current?.();
      owner.recoveryOwnedByServer = true;
      owner.avatarClient?.interrupt();
      owner.avatarClient?.exit();
      owner.avatarClient = null;

      const cloudSession = owner.session;
      if (!cloudSession) {
        return Promise.reject(new Error("DIGITAL_HUMAN_SESSION_UNAVAILABLE"));
      }
      const pending = (async () => {
        const response = await fetch(
          `/api/digital-human/sessions/${encodeURIComponent(cloudSession.id)}/downgrade`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reasonCode })
          }
        );
        const payload = (await response.json().catch(() => null)) as {
          session?: unknown;
        } | null;
        if (
          !response.ok ||
          !isDigitalHumanSession(payload?.session) ||
          payload.session.id !== cloudSession.id ||
          payload.session.mode !== "LOCAL_AVATAR"
        ) {
          throw new Error("DIGITAL_HUMAN_DOWNGRADE_FAILED");
        }
        owner.session = payload.session;
        owner.recoveryOwnedByServer = false;
        return payload.session;
      })();
      owner.downgradePromise = pending.catch((error) => {
        owner.session = null;
        throw error;
      });
      return owner.downgradePromise;
    },
    []
  );

  const speakWithBrowser = useCallback(
    (message: string) => {
      const generation = stopSpeech(false);
      if (!canUseSpeechSynthesis()) {
        if (playbackGuard.isCurrent(generation)) {
          setSpeechState("unsupported");
          setSpeechMode("BROWSER_TTS_FALLBACK");
          setSpeechMessage("语音不可用，请阅读题目");
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
          setSpeechMessage("语音不可用，请阅读题目");
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
          setSpeechMessage("语音不可用，请阅读题目");
        }
      }
    },
    [playbackGuard, prompt, stopSpeech]
  );

  useEffect(() => {
    let subscribed = true;
    stopSpeech(true);
    setDigitalSession(null);
    digitalSessionRef.current = null;
    setSessionUnavailable(false);
    setSpeechMode(null);
    setSpeechMessage("");
    setAvatarMessage("");
    setActiveAvatarMode(sessionId ? "CONNECTING" : "LOCAL_AVATAR");

    if (!sessionId) {
      const existing = sessionOwnershipRef.current;
      sessionOwnershipRef.current = null;
      if (existing) {
        const ownedClient = existing.avatarClient;
        const ownedSession = existing.session;
        finalizeDigitalHumanSessionOwnership(existing);
        if (avatarClientRef.current === ownedClient) avatarClientRef.current = null;
        if (digitalSessionRef.current === ownedSession) {
          digitalSessionRef.current = null;
        }
      }
      return () => {
        subscribed = false;
        stopSpeech(false);
      };
    }

    let owner = sessionOwnershipRef.current;
    if (
      !owner ||
      owner.finalized ||
      owner.trainingSessionId !== sessionId
    ) {
      if (owner) {
        const ownedClient = owner.avatarClient;
        const ownedSession = owner.session;
        finalizeDigitalHumanSessionOwnership(owner);
        if (avatarClientRef.current === ownedClient) avatarClientRef.current = null;
        if (digitalSessionRef.current === ownedSession) {
          digitalSessionRef.current = null;
        }
      }
      const controller = new AbortController();
      owner = {
        trainingSessionId: sessionId,
        controller,
        promise: Promise.resolve(null as never),
        session: null,
        avatarClient: null,
        lease: 0,
        finalized: false,
        deleteRequested: false,
        recoveryOwnedByServer: false,
        downgradePromise: null
      };
      const createdOwner = owner;
      const root = avatarRootRef.current;
      owner.promise = (async () => {
        const response = await fetch("/api/digital-human/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ trainingSessionId: sessionId })
        });
        const payload = (await response.json().catch(() => null)) as {
          session?: unknown;
        } | null;
        if (!response.ok || !isDigitalHumanSession(payload?.session)) {
          throw new Error("DIGITAL_HUMAN_SESSION_UNAVAILABLE");
        }
        const createdSession = payload.session;
        createdOwner.session = createdSession;
        if (createdOwner.finalized) {
          deleteOwnedDigitalHumanSession(createdOwner);
          throw new DOMException("Session finalized", "AbortError");
        }

        if (createdSession.mode === "LINGMOU_CLOUD" && createdSession.connection) {
          try {
            if (!root) throw new Error("LINGMOU_ROOT_UNAVAILABLE");
            const client = await createLingmouAvatarClient();
            createdOwner.avatarClient = client;
            if (createdOwner.finalized) {
              client.exit();
              throw new DOMException("Session finalized", "AbortError");
            }
            await client.start(createdSession.connection, root);
            if (createdOwner.finalized) {
              client.exit();
              throw new DOMException("Session finalized", "AbortError");
            }
            return {
              session: createdSession,
              avatarClient: client,
              avatarMode: "LINGMOU_CLOUD",
              avatarMessage: ""
            };
          } catch (error) {
            if (
              createdOwner.finalized ||
              caughtErrorName(error) === "AbortError"
            ) {
              throw error;
            }
            const localSession = await requestOwnedDowngrade(
              createdOwner,
              "CLIENT_SDK_INIT_FAILED"
            );
            return {
              session: localSession,
              avatarClient: null,
              avatarMode: "LOCAL_AVATAR",
              avatarMessage: "数字人画面已降级"
            };
          }
        }

        return {
          session: createdSession,
          avatarClient: null,
          avatarMode: "LOCAL_AVATAR",
          avatarMessage: ""
        };
      })();
      sessionOwnershipRef.current = owner;
    }

    owner.lease += 1;
    const lease = owner.lease;
    const activeOwner = owner;
    void activeOwner.promise.then(
      (activation) => {
        if (
          !subscribed ||
          activeOwner.finalized ||
          sessionOwnershipRef.current !== activeOwner
        ) {
          return;
        }
        digitalSessionRef.current = activation.session;
        avatarClientRef.current = activation.avatarClient;
        setActiveAvatarMode(activation.avatarMode);
        setAvatarMessage(activation.avatarMessage);
        setDigitalSession(activation.session);
      },
      (error) => {
        if (
          !subscribed ||
          activeOwner.finalized ||
          caughtErrorName(error) === "AbortError" ||
          sessionOwnershipRef.current !== activeOwner
        ) {
          return;
        }
        setActiveAvatarMode("LOCAL_AVATAR");
        setSessionUnavailable(true);
      }
    );

    return () => {
      subscribed = false;
      stopSpeech(false);
      void Promise.resolve().then(() => {
        if (
          sessionOwnershipRef.current !== activeOwner ||
          activeOwner.finalized ||
          activeOwner.lease !== lease
        ) {
          return;
        }
        sessionOwnershipRef.current = null;
        const ownedClient = activeOwner.avatarClient;
        const ownedSession = activeOwner.session;
        finalizeDigitalHumanSessionOwnership(activeOwner);
        if (avatarClientRef.current === ownedClient) {
          avatarClientRef.current = null;
        }
        if (digitalSessionRef.current === ownedSession) {
          digitalSessionRef.current = null;
        }
      });
    };
  }, [requestOwnedDowngrade, sessionId, setActiveAvatarMode, stopSpeech]);

  useEffect(() => {
    if (!digitalSession || digitalSession.mode !== "LINGMOU_CLOUD") return;
    const heartbeat = () => {
      void fetch(
        `/api/digital-human/sessions/${encodeURIComponent(digitalSession.id)}/heartbeat`,
        { method: "POST" }
      ).catch(() => undefined);
    };
    const interval = globalThis.setInterval(heartbeat, 20_000);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      globalThis.clearInterval(interval);
      if (heartbeatStopRef.current === stop) heartbeatStopRef.current = null;
    };
    heartbeatStopRef.current = stop;
    return stop;
  }, [digitalSession]);

  useEffect(() => {
    stopSpeech(true);
    setSpeechMode(null);
    setSpeechMessage("");
  }, [questionId, stopSpeech]);

  const isCurrentProviderAudio = useCallback(
    (audio: HTMLAudioElement) => {
      const generation = activeAudioGenerationRef.current;
      const currentSource = audio.currentSrc || audio.src;
      return (
        providerAudioActiveRef.current &&
        generation !== null &&
        playbackGuard.isCurrent(generation) &&
        Boolean(activeAudioSourceRef.current) &&
        currentSource === activeAudioSourceRef.current
      );
    },
    [playbackGuard]
  );

  const hasCurrentSessionOwnership = useCallback(
    (session: PublicDigitalHumanSession | null) => {
      if (!sessionId) return true;
      const owner = sessionOwnershipRef.current;
      return Boolean(
        owner &&
          !owner.finalized &&
          owner.trainingSessionId === sessionId &&
          owner.session === session &&
          digitalSessionRef.current === session
      );
    },
    [sessionId]
  );

  const playPrompt = useCallback(async (autoKey?: string) => {
    if (sessionId && !hasCurrentSessionOwnership(digitalSession)) return;
    const markAutoPlaybackStarted = () => {
      if (autoKey) lastAutoPlayedRef.current = autoKey;
    };
    const existingAudio = audioRef.current;
    if (
      speechState === "paused" &&
      existingAudio &&
      isCurrentProviderAudio(existingAudio)
    ) {
      try {
        markAutoPlaybackStarted();
        await existingAudio.play();
        if (isCurrentProviderAudio(existingAudio)) {
          setSpeechState("speaking");
          setSpeechMessage("正在播放 CosyVoice 语音。");
        }
      } catch (error) {
        if (
          caughtErrorName(error) === "NotAllowedError" &&
          isCurrentProviderAudio(existingAudio)
        ) {
          setSpeechState("paused");
          setSpeechMessage("CosyVoice 已生成，请再次点击播放问题。");
          return;
        }
        speakWithBrowser("CosyVoice 暂不可用，已切换为浏览器语音降级。");
      }
      return;
    }

    const generation = stopSpeech(false);
    setSpeechMessage("");

    if (!sessionId || !digitalSession) {
      if (sessionId && !sessionUnavailable) return;
      markAutoPlaybackStarted();
      speakWithBrowser(
        sessionId
          ? "CosyVoice 暂不可用，已切换为浏览器语音降级。"
          : "候场预览使用浏览器语音。"
      );
      return;
    }
    if (!questionId || !prompt.trim() || prompt.length > 600) {
      markAutoPlaybackStarted();
      speakWithBrowser("问题无法生成 CosyVoice，已切换为浏览器语音降级。");
      return;
    }

    markAutoPlaybackStarted();
    const controller = new AbortController();
    abortRef.current = controller;
    setSpeechState("loading");
    try {
      const response = await fetch(
        `/api/digital-human/sessions/${encodeURIComponent(digitalSession.id)}/speech`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ questionId, text: prompt, speed: 0.95 })
        }
      );
      if (!playbackGuard.isCurrent(generation)) return;
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          mode?: unknown;
        } | null;
        if (payload?.mode === "BROWSER_TTS_FALLBACK") {
          speakWithBrowser("CosyVoice 暂不可用，已切换为浏览器语音降级。");
          return;
        }
        throw new Error("TTS_REQUEST_FAILED");
      }
      if (!response.body) throw new Error("TTS_STREAM_MISSING");

      if (avatarModeRef.current === "LINGMOU_CLOUD" && avatarClientRef.current) {
        const decoder = new Pcm16LeDecoder();
        const reader = response.body.getReader();
        let previous: Int16Array | null = null;
        try {
          while (true) {
            const next = await reader.read();
            if (!playbackGuard.isCurrent(generation)) {
              await reader.cancel().catch(() => undefined);
              return;
            }
            if (next.done) break;
            const decoded = decoder.push(next.value);
            if (decoded.length === 0) continue;
            if (previous) avatarClientRef.current.pushPcm(previous, false);
            previous = decoded;
          }
          decoder.finish();
          if (!previous) throw new Error("TTS_STREAM_EMPTY");
          avatarClientRef.current.pushPcm(previous, true);
          setSpeechMode("COSYVOICE");
          setSpeechState("idle");
          setSpeechMessage("CosyVoice 播报已发送至灵眸数字人。");
        } catch (error) {
          if (
            !playbackGuard.isCurrent(generation) ||
            caughtErrorName(error) === "AbortError"
          ) {
            return;
          }
          stopSpeech(false);
          const owner = sessionOwnershipRef.current;
          try {
            if (!owner || owner.session !== digitalSession) {
              throw new Error("DIGITAL_HUMAN_SESSION_UNAVAILABLE");
            }
            const localSession = await requestOwnedDowngrade(
              owner,
              "CLIENT_PCM_PUSH_FAILED"
            );
            avatarClientRef.current = null;
            digitalSessionRef.current = localSession;
            setDigitalSession(localSession);
            setSessionUnavailable(false);
            setActiveAvatarMode("LOCAL_AVATAR");
            setAvatarMessage("数字人画面已降级");
            setSpeechState("idle");
            setSpeechMessage("");
            lastAutoPlayedRef.current = null;
          } catch {
            avatarClientRef.current = null;
            digitalSessionRef.current = null;
            setDigitalSession(null);
            setSessionUnavailable(true);
            setActiveAvatarMode("LOCAL_AVATAR");
            setAvatarMessage("数字人画面已降级");
            speakWithBrowser(
              "CosyVoice is unavailable; browser speech fallback is active."
            );
          }
          return;
        }
        return;
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const next = await reader.read();
        if (!playbackGuard.isCurrent(generation)) {
          await reader.cancel().catch(() => undefined);
          return;
        }
        if (next.done) break;
        chunks.push(next.value);
        totalBytes += next.value.byteLength;
      }
      if (totalBytes === 0) throw new Error("TTS_STREAM_EMPTY");
      const pcm = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const audio = audioRef.current;
      if (!audio || typeof URL.createObjectURL !== "function") {
        throw new Error("LOCAL_AUDIO_UNAVAILABLE");
      }
      const objectUrl = URL.createObjectURL(pcm16LeToWavBlob(pcm));
      objectUrlRef.current = objectUrl;
      providerAudioActiveRef.current = true;
      activeAudioGenerationRef.current = generation;
      audio.src = objectUrl;
      activeAudioSourceRef.current = audio.src;
      audio.currentTime = 0;
      audio.load();
      setSpeechMode("COSYVOICE");
      setSpeechMessage("正在播放 CosyVoice 语音。");
      await audio.play();
      if (playbackGuard.isCurrent(generation) && isCurrentProviderAudio(audio)) {
        setSpeechState("speaking");
      }
    } catch (error) {
      if (!playbackGuard.isCurrent(generation)) return;
      const errorName = caughtErrorName(error);
      if (errorName === "AbortError") return;
      if (
        errorName === "NotAllowedError" &&
        audioRef.current &&
        isCurrentProviderAudio(audioRef.current)
      ) {
        setSpeechState("paused");
        setSpeechMessage("CosyVoice 已生成，请再次点击播放问题。");
        return;
      }
      speakWithBrowser("CosyVoice 暂不可用，已切换为浏览器语音降级。");
    } finally {
      if (playbackGuard.isCurrent(generation) && abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [
    digitalSession,
    hasCurrentSessionOwnership,
    isCurrentProviderAudio,
    playbackGuard,
    prompt,
    questionId,
    requestOwnedDowngrade,
    sessionUnavailable,
    sessionId,
    speakWithBrowser,
    speechState,
    stopSpeech,
    setActiveAvatarMode
  ]);

  useEffect(() => {
    if ((!digitalSession && !sessionUnavailable) || !sessionId || !questionId) return;
    if (!hasCurrentSessionOwnership(digitalSession)) return;
    const autoKey = `${sessionId}:${questionId}`;
    if (lastAutoPlayedRef.current === autoKey) return;
    void playPrompt(autoKey);
  }, [
    digitalSession,
    hasCurrentSessionOwnership,
    playPrompt,
    questionId,
    sessionId,
    sessionUnavailable
  ]);

  function pauseSpeech() {
    if (providerAudioActiveRef.current && audioRef.current) {
      audioRef.current.pause();
      setSpeechState("paused");
      return;
    }
    if (avatarModeRef.current === "LINGMOU_CLOUD") {
      avatarClientRef.current?.interrupt();
      setSpeechState("paused");
      return;
    }
    if (canUseSpeechSynthesis() && utteranceRef.current) {
      window.speechSynthesis.pause();
      setSpeechState("paused");
    }
  }

  const modeText =
    speechState === "loading"
      ? "正在生成 CosyVoice"
      : speechMode === "COSYVOICE"
        ? "CosyVoice"
        : speechMode === "BROWSER_TTS_FALLBACK"
          ? "浏览器语音降级"
          : "CosyVoice 待播放";

  return (
    <section
      aria-label="数字人视频面试画面"
      className="relative overflow-hidden rounded-lg border border-slate-800 bg-[#111827] text-white shadow-sm"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.22),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(5,150,105,0.18),transparent_30%),linear-gradient(135deg,#111827,#1f2937_48%,#0f172a)]" />
      <div className="relative grid min-h-[360px] gap-5 p-5 md:grid-cols-[1fr_280px]">
        <div className="flex min-h-[300px] flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-blue-100">数字人面试官</p>
              <h2 className="mt-1 text-xl font-semibold">{interviewerName}</h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-blue-50">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              {statusText[displayStatus]}
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-sm flex-1 items-center justify-center py-5">
            <div className="relative aspect-[3/4] w-full max-w-[240px] overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 shadow-2xl">
              <video
                ref={avatarRootRef}
                data-testid="lingmou-avatar-root"
                aria-label="灵眸数字人视频"
                autoPlay
                playsInline
                className="absolute inset-0 h-full w-full rounded-[2rem] object-cover"
              />
              {!cloudReady ? (
                <div
                  data-testid="local-avatar-fallback"
                  className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-200 to-slate-500"
                >
                  <div className="relative h-24 w-24 rounded-full bg-gradient-to-b from-[#f2d5bf] to-[#c9876a] shadow-lg">
                    <div className="absolute left-5 top-10 h-2 w-3 rounded-full bg-slate-800" />
                    <div className="absolute right-5 top-10 h-2 w-3 rounded-full bg-slate-800" />
                    <div className={speechState === "speaking" ? "digital-mouth absolute left-1/2 top-14 h-1.5 w-9 -translate-x-1/2 rounded-full bg-rose-700/70" : "absolute left-1/2 top-14 h-1 w-8 -translate-x-1/2 rounded-full bg-rose-700/70"} />
                    <div className="absolute inset-x-3 -top-2 h-9 rounded-t-full bg-slate-900" />
                  </div>
                  <div className="mt-3 h-32 w-36 rounded-t-[3rem] bg-gradient-to-b from-slate-900 to-slate-700 shadow-xl" />
                </div>
              ) : null}
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2 py-1 text-[10px] text-blue-50">
                AI 生成数字人
              </span>
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
                  className="rounded-md bg-white/10 px-2 py-1 disabled:opacity-60"
                  type="button"
                  disabled={speechState === "loading" || !prompt.trim()}
                  onClick={() => void playPrompt()}
                >
                  {speechState === "loading" ? "生成语音中..." : "播放问题"}
                </button>
                <button className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1" type="button" onClick={pauseSpeech}>
                  <Pause className="h-3.5 w-3.5" aria-hidden />暂停朗读
                </button>
                <button className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1" type="button" onClick={() => void playPrompt()}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />重播
                </button>
              </div>
            </div>
            <audio
              ref={audioRef}
              aria-label="数字面试官语音播放器"
              className="sr-only"
              preload="none"
              onEnded={(event) => {
                if (!isCurrentProviderAudio(event.currentTarget)) return;
                stopSpeech(false);
                setSpeechState("idle");
                setSpeechMessage("CosyVoice 语音播放完成。");
              }}
              onError={(event) => {
                if (isCurrentProviderAudio(event.currentTarget)) {
                  speakWithBrowser("本地音频播放失败，已切换为浏览器语音降级。");
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-blue-100">
              <span className="rounded-full border border-emerald-200/30 bg-emerald-300/10 px-2 py-1">{modeText}</span>
              <span>灵眸真实数字人 / 本地数字人降级</span>
              <span aria-hidden="true">·</span>
              <span>CosyVoice / 浏览器语音降级</span>
            </div>
            <p className="text-base leading-7 text-white">{prompt}</p>
            {avatarMessage ? <p className="text-xs text-amber-100">{avatarMessage}</p> : null}
            {speechMessage ? <p className="text-xs text-amber-100">{speechMessage}</p> : null}
          </div>
        </div>

        <aside className="grid content-start gap-3 rounded-md border border-white/15 bg-white/10 p-4 text-sm backdrop-blur">
          <div><p className="text-xs text-blue-100">当前阶段</p><p className="mt-1 font-semibold">{stage}</p></div>
          <StatusLine icon={<Camera className="h-4 w-4" aria-hidden="true" />} label="摄像头已连接" />
          <StatusLine icon={<Mic className="h-4 w-4" aria-hidden="true" />} label="麦克风待录入" />
          <StatusLine icon={<Radio className="h-4 w-4" aria-hidden="true" />} label="AI 追问引擎在线" />
          {!compact ? <div className="mt-2 rounded-md bg-black/25 p-3 text-xs leading-5 text-blue-50">灵眸不可用时保留本地数字人；CosyVoice 不可用时再使用浏览器语音，面试文字始终可读。</div> : null}
        </aside>
      </div>
    </section>
  );
}

function StatusLine({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div className="flex items-center gap-2 rounded-md bg-black/20 px-3 py-2 text-blue-50">{icon}<span>{label}</span></div>;
}

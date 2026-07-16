import { z } from "zod";

const openState = 1;
const closingState = 2;
const closedState = 3;
const connectionTimeoutMs = 10_000;
const finishTimeoutMs = 1_500;
export const ALIBABA_REALTIME_ASR = "ALIBABA_REALTIME_ASR" as const;

const ticketResponseSchema = z
  .object({
    mode: z.literal(ALIBABA_REALTIME_ASR),
    webSocketUrl: z.string().min(1).max(2_048),
    expiresAt: z.string().datetime(),
    model: z.string().min(1).max(200),
    audio: z
      .object({
        format: z.literal("pcm"),
        sampleRate: z.union([z.literal(8_000), z.literal(16_000)]),
        channels: z.literal(1),
        language: z.string().trim().min(1).max(16)
      })
      .strict()
  })
  .strict();

const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }).strict(),
  z
    .object({ type: z.literal("partial"), text: z.string() })
    .strict(),
  z.object({ type: z.literal("final"), text: z.string() }).strict(),
  z.object({ type: z.literal("finished") }).strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean()
    })
    .strict()
]);

export type AlibabaAsrClientState =
  | "connecting"
  | "listening"
  | "stopped";

export type AlibabaAsrClientOptions = {
  sessionId: string;
  stream: MediaStream;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onState: (state: AlibabaAsrClientState) => void;
  onError: (message: string) => void;
};

type SocketEvent = {
  data?: unknown;
  code?: number;
};

type ClientWebSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: SocketEvent) => void
  ): void;
  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: SocketEvent) => void
  ): void;
};

type AudioNodeLike = {
  connect(destination: unknown): unknown;
  disconnect(): void;
};

type GainNodeLike = AudioNodeLike & {
  gain: { value: number };
};

type WorkletNodeLike = AudioNodeLike & {
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
  };
};

type AudioContextLike = {
  state: string;
  destination: unknown;
  audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): AudioNodeLike;
  createGain(): GainNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
};

type FetchResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type AlibabaAsrClientDependencies = {
  fetcher: (
    input: string,
    init: RequestInit
  ) => Promise<FetchResponseLike>;
  createWebSocket: (url: string) => ClientWebSocket;
  createAudioContext: () => AudioContextLike;
  createAudioWorkletNode: (
    context: AudioContextLike,
    name: string,
    options: AudioWorkletNodeOptions
  ) => WorkletNodeLike;
  createEventId: () => string;
  scheduleTimeout: (callback: () => void, delayMs: number) => () => void;
  pageUrl: () => string;
};

export type AlibabaAsrClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

class AlibabaAsrClientError extends Error {
  constructor(
    message: string,
    readonly userMessage: string
  ) {
    super(message);
    this.name = "AlibabaAsrClientError";
  }
}

function defaultScheduleTimeout(callback: () => void, delayMs: number) {
  const timer = window.setTimeout(callback, delayMs);
  return () => window.clearTimeout(timer);
}

function defaultDependencies(): AlibabaAsrClientDependencies {
  return {
    fetcher: (input, init) => fetch(input, init),
    createWebSocket: (url) => new WebSocket(url) as unknown as ClientWebSocket,
    createAudioContext: () =>
      new AudioContext() as unknown as AudioContextLike,
    createAudioWorkletNode: (context, name, options) =>
      new AudioWorkletNode(
        context as unknown as BaseAudioContext,
        name,
        options
      ) as unknown as WorkletNodeLike,
    createEventId: () =>
      globalThis.crypto?.randomUUID?.() ??
      `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scheduleTimeout: defaultScheduleTimeout,
    pageUrl: () => window.location.href
  };
}

function sameOriginWebSocketUrl(value: string, pageUrl: string) {
  const page = new URL(pageUrl);
  const endpoint = new URL(value, page);
  const expectedProtocol = page.protocol === "https:" ? "wss:" : "ws:";

  if (endpoint.protocol === "http:" || endpoint.protocol === "https:") {
    endpoint.protocol = expectedProtocol;
  }

  if (
    endpoint.protocol !== expectedProtocol ||
    endpoint.host !== page.host ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/ws/asr"
  ) {
    throw new AlibabaAsrClientError(
      "Expected a same-origin ASR WebSocket URL",
      "语音识别连接信息无效，请刷新页面后重试。"
    );
  }

  return endpoint.toString();
}

function bufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function safeClientError(error: unknown) {
  return error instanceof AlibabaAsrClientError
    ? error
    : new AlibabaAsrClientError(
        "Alibaba realtime ASR client failed",
        "阿里实时识别暂不可用，将尝试浏览器识别。"
      );
}

export function createAlibabaAsrClient(
  options: AlibabaAsrClientOptions,
  overrides: Partial<AlibabaAsrClientDependencies> = {}
): AlibabaAsrClient {
  const deps = { ...defaultDependencies(), ...overrides };
  let phase: "idle" | "connecting" | "listening" | "stopping" | "stopped" = "idle";
  let socket: ClientWebSocket | null = null;
  let audioContext: AudioContextLike | null = null;
  let source: AudioNodeLike | null = null;
  let worklet: WorkletNodeLike | null = null;
  let gain: GainNodeLike | null = null;
  let cancelConnectionTimeout: () => void = () => undefined;
  let intentionalStop = false;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  let finishResolve: (() => void) | null = null;
  let stopPromise: Promise<void> | null = null;
  let committedTranscript = "";

  const sendEvent = (event: Record<string, unknown>) => {
    if (!socket || socket.readyState !== openState) {
      throw new AlibabaAsrClientError(
        "ASR WebSocket is not open",
        "阿里实时识别连接已中断，将尝试浏览器识别。"
      );
    }

    socket.send(JSON.stringify(event));
  };

  const releaseAudio = async () => {
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.disconnect();
      worklet = null;
    }
    source?.disconnect();
    source = null;
    gain?.disconnect();
    gain = null;

    const context = audioContext;
    audioContext = null;
    if (context) {
      await context.close().catch(() => undefined);
    }
  };

  const onMessage = (message: SocketEvent) => {
    if (typeof message.data !== "string") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      return;
    }

    const result = serverEventSchema.safeParse(parsed);
    if (!result.success) {
      return;
    }

    const event = result.data;
    if (event.type === "ready") {
      readyResolve?.();
    } else if (event.type === "partial") {
      options.onPartial(`${committedTranscript}${event.text}`);
    } else if (event.type === "final") {
      committedTranscript = `${committedTranscript}${event.text}`;
      options.onFinal(committedTranscript);
    } else if (event.type === "error") {
      const error = new AlibabaAsrClientError(
        `ASR gateway error: ${event.code}`,
        event.message
      );
      readyReject?.(error);
      if (phase === "listening") {
        options.onError(event.message);
      }
    } else if (finishResolve) {
      finishResolve();
    } else {
      void stop(false);
    }
  };

  const onSocketError = () => {
    readyReject?.(
      new AlibabaAsrClientError(
        "ASR WebSocket connection failed",
        "阿里实时识别连接失败，将尝试浏览器识别。"
      )
    );
  };

  const onSocketClose = (event: SocketEvent) => {
    finishResolve?.();

    if (!intentionalStop && phase === "connecting") {
      readyReject?.(
        new AlibabaAsrClientError(
          `ASR WebSocket closed before ready (${event.code ?? 1006})`,
          "阿里实时识别连接失败，将尝试浏览器识别。"
        )
      );
    } else if (!intentionalStop && phase === "listening") {
      phase = "stopped";
      void releaseAudio();
      options.onState("stopped");
      if (event.code !== 1000) {
        options.onError("阿里实时识别连接已中断，可以切换到浏览器识别。");
      }
    }
  };

  async function start() {
    if (phase !== "idle") {
      throw new AlibabaAsrClientError(
        "ASR client can only be started once",
        "语音识别已经启动。"
      );
    }

    if (options.stream.getAudioTracks().every((track) => track.readyState === "ended")) {
      throw new AlibabaAsrClientError(
        "A live microphone track is required",
        "麦克风尚未连接，请重新开启设备后再试。"
      );
    }

    phase = "connecting";
    committedTranscript = "";
    options.onState("connecting");

    try {
      audioContext = deps.createAudioContext();
      const resumeAudio =
        audioContext.state === "suspended"
          ? audioContext.resume()
          : Promise.resolve();
      const responseRequest = deps.fetcher(
        "/api/speech-recognition/sessions",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: options.sessionId })
        }
      );
      await resumeAudio;
      const response = await responseRequest;

      if (phase !== "connecting") {
        throw new AlibabaAsrClientError(
          "ASR client stopped during ticket request",
          "语音识别连接已取消。"
        );
      }

      if (!response.ok) {
        throw new AlibabaAsrClientError(
          `ASR ticket request failed (${response.status})`,
          "阿里实时识别暂不可用，将尝试浏览器识别。"
        );
      }

      const ticketResult = ticketResponseSchema.safeParse(await response.json());
      if (!ticketResult.success) {
        throw new AlibabaAsrClientError(
          "ASR ticket response is invalid",
          "语音识别连接信息无效，请刷新页面后重试。"
        );
      }

      if (phase !== "connecting") {
        throw new AlibabaAsrClientError(
          "ASR client stopped before WebSocket setup",
          "语音识别连接已取消。"
        );
      }

      const ticket = ticketResult.data;
      const socketUrl = sameOriginWebSocketUrl(
        ticket.webSocketUrl,
        deps.pageUrl()
      );
      socket = deps.createWebSocket(socketUrl);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onSocketError);
      socket.addEventListener("close", onSocketClose);

      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      cancelConnectionTimeout = deps.scheduleTimeout(() => {
        readyReject?.(
          new AlibabaAsrClientError(
            "ASR WebSocket readiness timeout",
            "阿里实时识别连接超时，将尝试浏览器识别。"
          )
        );
      }, connectionTimeoutMs);

      await ready;
      cancelConnectionTimeout();
      readyResolve = null;
      readyReject = null;

      if (phase !== "connecting") {
        throw new AlibabaAsrClientError(
          "ASR client stopped while connecting",
          "语音识别连接已取消。"
        );
      }

      sendEvent({
        event_id: deps.createEventId(),
        type: "session.update",
        session: {
          input_audio_format: ticket.audio.format,
          sample_rate: ticket.audio.sampleRate,
          input_audio_transcription: { language: ticket.audio.language },
          turn_detection: { type: "server_vad" }
        }
      });

      const context = audioContext;
      if (!context) {
        throw new AlibabaAsrClientError(
          "Audio context was released during setup",
          "语音采集已停止。"
        );
      }
      await context.audioWorklet.addModule("/audio/pcm16-worklet.js");

      source = context.createMediaStreamSource(options.stream);
      worklet = deps.createAudioWorkletNode(context, "pcm16-worklet", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { targetSampleRate: ticket.audio.sampleRate }
      });
      gain = context.createGain();
      gain.gain.value = 0;
      worklet.port.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer) || socket?.readyState !== openState) {
          return;
        }

        sendEvent({
          event_id: deps.createEventId(),
          type: "input_audio_buffer.append",
          audio: bufferToBase64(event.data)
        });
      };
      source.connect(worklet);
      worklet.connect(gain);
      gain.connect(context.destination);

      phase = "listening";
      options.onState("listening");
    } catch (error) {
      const safeError = safeClientError(error);
      cancelConnectionTimeout();
      readyResolve = null;
      readyReject = null;
      await releaseAudio();
      if (socket && socket.readyState !== closedState) {
        socket.close(1011, "ASR client setup failed");
      }
      phase = "stopped";
      options.onState("stopped");
      options.onError(safeError.userMessage);
      throw safeError;
    }
  }

  async function stop(sendFinish = true) {
    if (stopPromise) {
      return stopPromise;
    }

    if (phase === "stopped") {
      return;
    }

    const wasListening = phase === "listening";
    phase = "stopping";
    stopPromise = (async () => {
      intentionalStop = true;
      cancelConnectionTimeout();
      readyReject?.(
        new AlibabaAsrClientError(
          "ASR client stopped",
          "语音识别连接已停止。"
        )
      );
      readyResolve = null;
      readyReject = null;

      // Freeze capture before session.finish. At most one sub-20 ms worklet
      // buffer is intentionally dropped because the protocol has no client
      // flush acknowledgement for a partial PCM chunk.
      await releaseAudio();

      if (sendFinish && socket?.readyState === openState && wasListening) {
        await new Promise<void>((resolve) => {
          let settled = false;
          let cancelFinishTimeout: () => void = () => undefined;
          const complete = () => {
            if (settled) {
              return;
            }
            settled = true;
            cancelFinishTimeout();
            finishResolve = null;
            resolve();
          };

          finishResolve = complete;
          cancelFinishTimeout = deps.scheduleTimeout(
            complete,
            finishTimeoutMs
          );
          try {
            sendEvent({
              event_id: deps.createEventId(),
              type: "session.finish"
            });
          } catch {
            complete();
          }
        });
      }

      if (
        socket &&
        socket.readyState !== closingState &&
        socket.readyState !== closedState
      ) {
        socket.close(1000, "ASR client stopped");
      }
      phase = "stopped";
      options.onState("stopped");
    })();

    return stopPromise;
  }

  return { start, stop: () => stop(true) };
}

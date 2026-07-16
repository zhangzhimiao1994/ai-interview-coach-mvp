import type { IncomingMessage } from "node:http";
import WebSocket, { type ClientOptions, type RawData } from "ws";
import {
  resolveMediaModelById,
  type ResolvedMediaModel
} from "@/lib/media/config";
import {
  buildAlibabaAsrUrl,
  parseAlibabaAsrClientEvent,
  parseAlibabaAsrEvent,
  resolveAlibabaAsrAudioConfig,
  type AlibabaAsrClientEvent,
  type ClientAsrEvent
} from "@/lib/media/providers/alibabaAsr";
import {
  resolveAlibabaAsrCredentials,
  type AlibabaAsrCredentials
} from "@/lib/media/providers/alibabaCredentials";
import {
  realtimeTicketStore,
  type RealtimeTicketStore
} from "@/lib/realtime/tickets";

const openState = 1;
const closedState = 3;
const maximumMessageBytes = 96 * 1024;
const defaultMaximumSessionMs = 10 * 60_000;
const maximumSessionMs = 30 * 60_000;

type AsrSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): unknown;
  on(
    event: "message",
    listener: (data: RawData, isBinary: boolean) => void
  ): unknown;
  on(event: "close", listener: (code: number) => void): unknown;
  on(event: "error", listener: () => void): unknown;
};

type AsrGatewayDependencies = {
  ticketStore: Pick<RealtimeTicketStore, "consume">;
  resolveModelById: (
    modelId: string,
    capability: "SPEECH_TO_TEXT"
  ) => Promise<ResolvedMediaModel>;
  resolveCredentials: (model: ResolvedMediaModel) => AlibabaAsrCredentials;
  createUpstreamSocket: (url: string, options: ClientOptions) => AsrSocket;
  scheduleTimeout: (callback: () => void, delayMs: number) => () => void;
  logError: (message: string) => void;
};

function scheduleTimeout(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}

function defaultDependencies(): AsrGatewayDependencies {
  return {
    ticketStore: realtimeTicketStore,
    resolveModelById: resolveMediaModelById,
    resolveCredentials: resolveAlibabaAsrCredentials,
    createUpstreamSocket: (url, options) => new WebSocket(url, options),
    scheduleTimeout,
    logError: (message) => console.error(message)
  };
}

function messageText(data: RawData) {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
}

function sendClientEvent(socket: AsrSocket, event: ClientAsrEvent) {
  if (socket.readyState === openState) {
    socket.send(JSON.stringify(event));
  }
}

function configuredMaximumSessionMs(model: ResolvedMediaModel) {
  const configured = model.modelSettings.maxSessionDurationMs;

  return typeof configured === "number" &&
    Number.isInteger(configured) &&
    configured >= 30_000 &&
    configured <= maximumSessionMs
    ? configured
    : defaultMaximumSessionMs;
}

function normalizedClientEvent(
  event: AlibabaAsrClientEvent,
  model: ResolvedMediaModel
): AlibabaAsrClientEvent {
  if (event.type !== "session.update") {
    return event;
  }

  const audio = resolveAlibabaAsrAudioConfig(model);

  return {
    ...event,
    session: {
      ...event.session,
      input_audio_format: audio.encoding,
      sample_rate: audio.sampleRate,
      input_audio_transcription: { language: audio.language }
    }
  };
}

export function createAsrGateway(
  overrides: Partial<AsrGatewayDependencies> = {}
) {
  const deps = { ...defaultDependencies(), ...overrides };

  return async function handleAsrConnection(
    browser: AsrSocket,
    request: IncomingMessage
  ) {
    let upstream: AsrSocket | null = null;
    let closing = false;
    let upstreamOpened = false;
    let cancelConnectionTimeout: () => void = () => undefined;
    let cancelSessionTimeout: () => void = () => undefined;

    const closeBoth = (
      browserCode: number,
      browserReason: string,
      upstreamCode = 1000
    ) => {
      if (closing) {
        return;
      }

      closing = true;
      cancelConnectionTimeout();
      cancelSessionTimeout();

      if (upstream && upstream.readyState !== closedState) {
        upstream.close(upstreamCode, "ASR gateway closing");
      }
      if (browser.readyState === openState) {
        browser.close(browserCode, browserReason);
      }
    };

    const failClientEvent = (
      code: string,
      message: string,
      closeCode: number,
      closeReason: string,
      retryable = false,
      upstreamCode = 1008
    ) => {
      sendClientEvent(browser, {
        type: "error",
        code,
        message,
        retryable
      });
      closeBoth(closeCode, closeReason, upstreamCode);
    };

    browser.on("close", () => {
      closeBoth(1000, "ASR client disconnected");
    });
    browser.on("error", () => {
      if (closing) {
        return;
      }

      deps.logError("ASR browser socket error");
      closeBoth(1011, "ASR client error", 1011);
    });

    const ticket = new URL(request.url ?? "/", "http://localhost").searchParams
      .get("ticket")
      ?.trim();
    const ticketPayload = ticket ? deps.ticketStore.consume(ticket) : null;

    if (!ticketPayload) {
      closeBoth(1008, "Invalid or expired ASR ticket");
      return;
    }

    try {
      const model = await deps.resolveModelById(
        ticketPayload.modelId,
        "SPEECH_TO_TEXT"
      );

      if (closing || browser.readyState !== openState) {
        return;
      }

      const credentials = deps.resolveCredentials(model);
      const upstreamUrl = buildAlibabaAsrUrl({
        workspaceId: credentials.workspaceId,
        region: credentials.region,
        modelName: model.modelName
      });
      upstream = deps.createUpstreamSocket(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "X-DashScope-WorkSpace": credentials.workspaceId,
          "User-Agent": "ai-interview-coach/0.1"
        }
      });

      upstream.on("open", () => {
        upstreamOpened = true;
        cancelConnectionTimeout();
      });

      upstream.on("message", (data, isBinary) => {
        if (closing || isBinary) {
          return;
        }

        const message = messageText(data);
        if (Buffer.byteLength(message, "utf8") > maximumMessageBytes) {
          failClientEvent(
            "UPSTREAM_EVENT_TOO_LARGE",
            "语音识别服务返回了无效事件。",
            1011,
            "Invalid ASR upstream event",
            true,
            1011
          );
          return;
        }

        const event = parseAlibabaAsrEvent(message);
        if (!event) {
          return;
        }

        sendClientEvent(browser, event);

        if (event.type === "error") {
          closeBoth(1011, "ASR upstream error", 1011);
        } else if (event.type === "finished") {
          closeBoth(1000, "ASR session finished");
        }
      });

      upstream.on("close", (code) => {
        if (closing) {
          return;
        }

        if (code !== 1000) {
          sendClientEvent(browser, {
            type: "error",
            code: "UPSTREAM_CONNECTION_CLOSED",
            message: "语音识别连接已中断，请重试。",
            retryable: true
          });
        }
        closeBoth(
          code === 1000 ? 1000 : 1011,
          code === 1000 ? "ASR session closed" : "ASR upstream disconnected"
        );
      });

      upstream.on("error", () => {
        if (closing) {
          return;
        }

        deps.logError("Alibaba ASR upstream socket error");
        failClientEvent(
          "UPSTREAM_CONNECTION_ERROR",
          "语音识别连接失败，请重试。",
          1011,
          "ASR upstream error",
          true,
          1011
        );
      });

      browser.on("message", (data, isBinary) => {
        if (closing) {
          return;
        }

        const message = messageText(data);
        if (
          isBinary ||
          Buffer.byteLength(message, "utf8") > maximumMessageBytes
        ) {
          failClientEvent(
            "INVALID_CLIENT_EVENT",
            "语音识别客户端事件无效。",
            1008,
            "Invalid ASR client event"
          );
          return;
        }

        const event = parseAlibabaAsrClientEvent(message);
        if (!event) {
          failClientEvent(
            "INVALID_CLIENT_EVENT",
            "语音识别客户端事件无效。",
            1008,
            "Invalid ASR client event"
          );
          return;
        }

        if (!upstreamOpened || upstream?.readyState !== openState) {
          failClientEvent(
            "UPSTREAM_NOT_READY",
            "语音识别服务仍在连接，请重试。",
            1013,
            "ASR upstream not ready",
            true,
            1000
          );
          return;
        }

        upstream.send(JSON.stringify(normalizedClientEvent(event, model)));
      });

      cancelConnectionTimeout = deps.scheduleTimeout(() => {
        failClientEvent(
          "UPSTREAM_CONNECT_TIMEOUT",
          "语音识别连接超时，请重试。",
          1013,
          "ASR upstream timeout",
          true,
          1011
        );
      }, Math.min(Math.max(model.timeoutMs, 1_000), 30_000));
      cancelSessionTimeout = deps.scheduleTimeout(() => {
        failClientEvent(
          "SESSION_DURATION_LIMIT",
          "本次语音识别已达到最长时限。",
          1000,
          "ASR session duration limit",
          false,
          1000
        );
      }, configuredMaximumSessionMs(model));
    } catch {
      if (closing) {
        return;
      }

      deps.logError("ASR gateway setup failed");
      sendClientEvent(browser, {
        type: "error",
        code: "ASR_GATEWAY_UNAVAILABLE",
        message: "语音识别服务暂不可用，请检查后台配置。",
        retryable: false
      });
      closeBoth(1011, "ASR gateway unavailable", 1011);
    }
  };
}

export const handleAsrConnection = createAsrGateway();

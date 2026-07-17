import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAsrGateway } from "@/lib/realtime/asrGateway";
import { createRealtimeTicketStore } from "@/lib/realtime/tickets";
import type { ResolvedMediaModel } from "@/lib/media/config";

class FakeSocket extends EventEmitter {
  readyState: number;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];

  constructor(readyState = 1) {
    super();
    this.readyState = readyState;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
    this.readyState = 3;
  }
}

function asrModel(): ResolvedMediaModel {
  return {
    capability: "SPEECH_TO_TEXT",
    providerId: "provider-1",
    providerName: "阿里百炼",
    providerType: "TONGYI",
    providerConfigVersion: 0,
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    providerSettings: {
      workspaceId: "ws-main",
      region: "cn-beijing"
    },
    modelId: "model-asr",
    modelDisplayName: "阿里实时语音识别",
    modelName: "qwen3-asr-flash-realtime",
    modelSettings: {
      language: "zh-CN",
      sampleRate: 16000,
      encoding: "pcm",
      maxSessionDurationMs: 300_000
    },
    temperature: 0,
    maxTokens: 1000,
    timeoutMs: 30_000,
    credentialEnvelopes: {
      apiKey: null,
      structured: null
    }
  };
}

function setup() {
  const tickets = createRealtimeTicketStore(() => 1_000);
  const ticket = tickets.issue(
    { sessionId: "session-1", modelId: "model-asr" },
    60_000
  );
  const browser = new FakeSocket();
  const upstream = new FakeSocket(0);
  const createUpstreamSocket = vi.fn(() => upstream);
  const resolveModelById = vi.fn().mockResolvedValue(asrModel());
  const resolveCredentials = vi.fn().mockReturnValue({
    apiKey: "asr-api-key-sentinel",
    workspaceId: "ws-main",
    region: "cn-beijing"
  });
  const cancelTimeout = vi.fn();
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const scheduleTimeout = vi.fn((callback: () => void, delayMs: number) => {
    scheduled.push({ callback, delayMs });
    return cancelTimeout;
  });
  const logError = vi.fn();
  const gateway = createAsrGateway({
    ticketStore: tickets,
    createUpstreamSocket,
    resolveModelById,
    resolveCredentials,
    scheduleTimeout,
    logError
  });

  return {
    ticket,
    browser,
    upstream,
    createUpstreamSocket,
    resolveModelById,
    resolveCredentials,
    scheduleTimeout,
    scheduled,
    logError,
    gateway
  };
}

describe("Alibaba ASR same-process gateway", () => {
  it("consumes a ticket, keeps credentials server-side, and forwards strict events", async () => {
    const context = setup();

    await context.gateway(
      context.browser as never,
      { url: `/ws/asr?ticket=${context.ticket}` } as never
    );

    expect(context.resolveModelById).toHaveBeenCalledWith(
      "model-asr",
      "SPEECH_TO_TEXT"
    );
    expect(context.createUpstreamSocket).toHaveBeenCalledWith(
      "wss://ws-main.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime",
      {
        headers: {
          Authorization: "Bearer asr-api-key-sentinel",
          "X-DashScope-WorkSpace": "ws-main",
          "User-Agent": "ai-interview-coach/0.1"
        }
      }
    );

    context.upstream.readyState = 1;
    context.upstream.emit("open");
    context.upstream.emit(
      "message",
      Buffer.from('{"type":"session.created"}'),
      false
    );
    context.browser.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event_id: "event-1",
          type: "session.update",
          session: {
            input_audio_format: "opus",
            sample_rate: 8000,
            input_audio_transcription: { language: "en" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.2,
              silence_duration_ms: 800
            }
          }
        })
      ),
      false
    );
    context.upstream.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.text",
          text: "你好",
          stash: "世界"
        })
      ),
      false
    );

    expect(context.browser.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "ready" },
      { type: "partial", text: "你好世界" }
    ]);
    expect(JSON.parse(context.upstream.sent[0])).toEqual({
      event_id: "event-1",
      type: "session.update",
      session: {
        input_audio_format: "pcm",
        sample_rate: 16000,
        input_audio_transcription: { language: "zh" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.2,
          silence_duration_ms: 800
        }
      }
    });
    expect(JSON.stringify(context.browser.sent)).not.toContain(
      "asr-api-key-sentinel"
    );
  });

  it("rejects an invalid browser event without forwarding its contents", async () => {
    const context = setup();

    await context.gateway(
      context.browser as never,
      { url: `/ws/asr?ticket=${context.ticket}` } as never
    );
    context.upstream.readyState = 1;
    context.upstream.emit("open");
    context.browser.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.create",
          secret: "browser-secret-sentinel"
        })
      ),
      false
    );

    expect(context.upstream.sent).toEqual([]);
    expect(context.browser.closed).toContainEqual({
      code: 1008,
      reason: "Invalid ASR client event"
    });
    expect(context.upstream.closed).toContainEqual({
      code: 1008,
      reason: "ASR gateway closing"
    });
    expect(JSON.stringify(context.browser.sent)).not.toContain(
      "browser-secret-sentinel"
    );
  });

  it("rejects missing or already-consumed tickets before opening upstream", async () => {
    const context = setup();

    await context.gateway(
      context.browser as never,
      { url: "/ws/asr?ticket=invalid" } as never
    );

    expect(context.createUpstreamSocket).not.toHaveBeenCalled();
    expect(context.browser.closed).toContainEqual({
      code: 1008,
      reason: "Invalid or expired ASR ticket"
    });
  });

  it("handles browser socket errors even when the ticket is invalid", async () => {
    const context = setup();

    await context.gateway(
      context.browser as never,
      { url: "/ws/asr?ticket=invalid" } as never
    );

    expect(() => context.browser.emit("error", new Error("bad frame"))).not.toThrow();
    expect(context.createUpstreamSocket).not.toHaveBeenCalled();
  });

  it("reports configuration failures without leaking resolver errors", async () => {
    const context = setup();
    context.resolveModelById.mockRejectedValueOnce(
      new Error("database included encrypted-secret-sentinel")
    );

    await context.gateway(
      context.browser as never,
      { url: `/ws/asr?ticket=${context.ticket}` } as never
    );

    expect(context.browser.closed).toContainEqual({
      code: 1011,
      reason: "ASR gateway unavailable"
    });
    expect(JSON.stringify(context.browser.sent)).not.toContain(
      "encrypted-secret-sentinel"
    );
    expect(context.logError).toHaveBeenCalledWith("ASR gateway setup failed");
  });

  it("does not open an upstream socket after the browser disconnects during model resolution", async () => {
    const context = setup();
    let finishResolving: ((model: ResolvedMediaModel) => void) | undefined;
    context.resolveModelById.mockImplementationOnce(
      () =>
        new Promise<ResolvedMediaModel>((resolve) => {
          finishResolving = resolve;
        })
    );

    const connection = context.gateway(
      context.browser as never,
      { url: `/ws/asr?ticket=${context.ticket}` } as never
    );
    context.browser.emit("close", 1000);
    finishResolving?.(asrModel());
    await connection;

    expect(context.createUpstreamSocket).not.toHaveBeenCalled();
  });

  it("closes both sockets when the configured session duration is reached", async () => {
    const context = setup();

    await context.gateway(
      context.browser as never,
      { url: `/ws/asr?ticket=${context.ticket}` } as never
    );
    context.upstream.readyState = 1;
    context.upstream.emit("open");

    expect(context.scheduled.map((item) => item.delayMs)).toEqual([
      30_000,
      300_000
    ]);
    context.scheduled[1].callback();

    expect(context.browser.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "error",
      code: "SESSION_DURATION_LIMIT",
      message: "本次语音识别已达到最长时限。",
      retryable: false
    });
    expect(context.browser.closed).toContainEqual({
      code: 1000,
      reason: "ASR session duration limit"
    });
    expect(context.upstream.closed).toContainEqual({
      code: 1000,
      reason: "ASR gateway closing"
    });
  });
});

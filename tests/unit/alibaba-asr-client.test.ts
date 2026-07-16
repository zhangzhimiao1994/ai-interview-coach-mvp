import { describe, expect, it, vi } from "vitest";
import { createAlibabaAsrClient } from "@/lib/client/alibabaAsrClient";

class FakeWebSocket {
  readyState = 0;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Set<(event: never) => void>>();

  addEventListener(type: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: never) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
    this.readyState = 3;
  }

  emit(type: string, event: unknown = {}) {
    if (type === "open") {
      this.readyState = 1;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }
}

function setup(webSocketUrl = "/ws/asr?ticket=one-time-ticket") {
  const socket = new FakeWebSocket();
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: vi.fn().mockResolvedValue({
      mode: "ALIBABA_REALTIME_ASR",
      webSocketUrl,
      expiresAt: "2026-07-16T11:00:00.000Z",
      model: "qwen3-asr-flash-realtime",
      audio: {
        format: "pcm",
        sampleRate: 16000,
        channels: 1,
        language: "zh"
      }
    })
  });
  const createWebSocket = vi.fn(() => socket);
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn()
  };
  const worklet = {
    port: { onmessage: null as ((event: { data: unknown }) => void) | null },
    connect: vi.fn(),
    disconnect: vi.fn()
  };
  const audioContext = {
    state: "running",
    destination: {},
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const createAudioContext = vi.fn(() => audioContext);
  const createAudioWorkletNode = vi.fn(() => worklet);
  const ids = ["event-1", "event-2", "event-3"];
  const createEventId = vi.fn(() => ids.shift() ?? "event-next");
  const cancelTimeout = vi.fn();
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const scheduleTimeout = vi.fn((callback: () => void, delayMs: number) => {
    scheduled.push({ callback, delayMs });
    return cancelTimeout;
  });
  const onPartial = vi.fn();
  const onFinal = vi.fn();
  const onState = vi.fn();
  const onError = vi.fn();
  const stream = { getAudioTracks: () => [{ readyState: "live" }] };
  const client = createAlibabaAsrClient(
    {
      sessionId: "session-1",
      stream: stream as never,
      onPartial,
      onFinal,
      onState,
      onError
    },
    {
      fetcher,
      createWebSocket,
      createAudioContext,
      createAudioWorkletNode,
      createEventId,
      scheduleTimeout,
      pageUrl: () => "https://interview.example/practice/task/room"
    }
  );

  return {
    client,
    socket,
    fetcher,
    createWebSocket,
    createAudioContext,
    audioContext,
    worklet,
    source,
    gain,
    scheduled,
    onPartial,
    onFinal,
    onState,
    onError
  };
}

describe("Alibaba realtime ASR browser client", () => {
  it("uses a same-origin ticket, waits for readiness, and streams only PCM events", async () => {
    const context = setup();
    const started = context.client.start();

    await vi.waitFor(() => expect(context.createWebSocket).toHaveBeenCalled());
    expect(context.fetcher).toHaveBeenCalledWith(
      "/api/speech-recognition/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1" })
      })
    );
    expect(context.createWebSocket).toHaveBeenCalledWith(
      "wss://interview.example/ws/asr?ticket=one-time-ticket"
    );

    context.socket.emit("open");
    context.socket.emit("message", {
      data: JSON.stringify({ type: "ready" })
    });
    await started;

    expect(JSON.parse(context.socket.sent[0])).toEqual({
      event_id: "event-1",
      type: "session.update",
      session: {
        input_audio_format: "pcm",
        sample_rate: 16000,
        input_audio_transcription: { language: "zh" },
        turn_detection: { type: "server_vad" }
      }
    });
    expect(context.audioContext.audioWorklet.addModule).toHaveBeenCalledWith(
      "/audio/pcm16-worklet.js"
    );
    expect(context.onState).toHaveBeenNthCalledWith(1, "connecting");
    expect(context.onState).toHaveBeenLastCalledWith("listening");

    context.worklet.port.onmessage?.({
      data: new Uint8Array([0, 1, 2]).buffer
    });
    expect(JSON.parse(context.socket.sent[1])).toEqual({
      event_id: "event-2",
      type: "input_audio_buffer.append",
      audio: "AAEC"
    });

    context.socket.emit("message", {
      data: JSON.stringify({ type: "partial", text: "你好" })
    });
    context.socket.emit("message", {
      data: JSON.stringify({ type: "final", text: "你好，世界" })
    });
    expect(context.onPartial).toHaveBeenCalledWith("你好");
    expect(context.onFinal).toHaveBeenCalledWith("你好，世界");

    context.socket.emit("message", {
      data: JSON.stringify({ type: "partial", text: "第二段" })
    });
    context.socket.emit("message", {
      data: JSON.stringify({ type: "final", text: "第二段回答。" })
    });
    expect(context.onPartial).toHaveBeenLastCalledWith("你好，世界第二段");
    expect(context.onFinal).toHaveBeenLastCalledWith(
      "你好，世界第二段回答。"
    );

    const stopped = context.client.stop();
    await vi.waitFor(() => expect(context.socket.sent).toHaveLength(3));
    expect(context.worklet.port.onmessage).toBeNull();
    expect(context.source.disconnect).toHaveBeenCalled();
    expect(JSON.parse(context.socket.sent[2])).toEqual({
      event_id: "event-3",
      type: "session.finish"
    });
    expect(context.socket.closed).toEqual([]);
    context.socket.emit("message", {
      data: JSON.stringify({ type: "finished" })
    });
    await stopped;
    expect(context.socket.closed).toContainEqual({
      code: 1000,
      reason: "ASR client stopped"
    });
    expect(context.audioContext.close).toHaveBeenCalled();
    expect(context.onState).toHaveBeenLastCalledWith("stopped");
  });

  it("rejects a cross-origin gateway URL before opening a WebSocket", async () => {
    const context = setup("wss://evil.example/ws/asr?ticket=stolen");

    await expect(context.client.start()).rejects.toThrow(
      "same-origin ASR WebSocket URL"
    );
    expect(context.createWebSocket).not.toHaveBeenCalled();
    expect(context.onError).toHaveBeenCalledWith(
      "语音识别连接信息无效，请刷新页面后重试。"
    );
  });

  it("fails safely when the gateway never becomes ready", async () => {
    const context = setup();
    const started = context.client.start();

    await vi.waitFor(() => expect(context.createWebSocket).toHaveBeenCalled());
    expect(context.scheduled).toHaveLength(1);
    expect(context.scheduled[0].delayMs).toBe(10_000);
    context.scheduled[0].callback();

    await expect(started).rejects.toThrow("readiness timeout");
    expect(context.socket.closed).toContainEqual({
      code: 1011,
      reason: "ASR client setup failed"
    });
    expect(context.onError).toHaveBeenCalledWith(
      "阿里实时识别连接超时，将尝试浏览器识别。"
    );
    expect(context.onState).toHaveBeenLastCalledWith("stopped");
  });

  it("does not open a WebSocket when stopped during the ticket request", async () => {
    const context = setup();
    let resolveRequest: ((response: unknown) => void) | undefined;
    context.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    const started = context.client.start();
    const rejected = expect(started).rejects.toThrow(
      "stopped during ticket request"
    );

    await vi.waitFor(() => expect(context.fetcher).toHaveBeenCalled());
    await context.client.stop();
    resolveRequest?.({
      ok: true,
      status: 201,
      json: async () => ({
        mode: "ALIBABA_REALTIME_ASR",
        webSocketUrl: "/ws/asr?ticket=one-time-ticket",
        expiresAt: "2026-07-16T11:00:00.000Z",
        model: "qwen3-asr-flash-realtime",
        audio: {
          format: "pcm",
          sampleRate: 16000,
          channels: 1,
          language: "zh"
        }
      })
    });

    await rejected;
    expect(context.createWebSocket).not.toHaveBeenCalled();
  });

  it("unlocks the audio context before awaiting network setup", async () => {
    const context = setup();
    context.audioContext.state = "suspended";
    let resolveRequest: ((response: unknown) => void) | undefined;
    context.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    const started = context.client.start();
    const rejected = expect(started).rejects.toThrow();
    expect(context.createAudioContext).toHaveBeenCalledTimes(1);
    expect(context.audioContext.resume).toHaveBeenCalledTimes(1);

    await context.client.stop();
    resolveRequest?.({ ok: false, status: 503, json: async () => ({}) });
    await rejected;
  });

  it("closes after a bounded wait when the finish acknowledgement is missing", async () => {
    const context = setup();
    const started = context.client.start();
    await vi.waitFor(() => expect(context.createWebSocket).toHaveBeenCalled());
    context.socket.emit("open");
    context.socket.emit("message", {
      data: JSON.stringify({ type: "ready" })
    });
    await started;

    const stopped = context.client.stop();
    await vi.waitFor(() => expect(context.scheduled).toHaveLength(2));
    expect(context.scheduled[1].delayMs).toBe(1_500);
    expect(context.socket.closed).toEqual([]);
    context.scheduled[1].callback();
    await stopped;

    expect(context.socket.closed).toContainEqual({
      code: 1000,
      reason: "ASR client stopped"
    });
  });
});

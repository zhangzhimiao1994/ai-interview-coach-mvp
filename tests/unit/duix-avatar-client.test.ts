import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigitalHumanConnection } from "@/lib/media/types";
import { createDuixAvatarClient } from "@/lib/client/duixAvatarClient";

const connection: DigitalHumanConnection = {
  protocol: "webrtc",
  metadata: {
    adapter: "DUIX_H5_SDK",
    sign: "jwt-sign",
    conversationId: "conv-1",
    platform: "duix.com",
    openAsr: false,
    speechMode: "duix-managed"
  }
};

describe("DUIX avatar client", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("initializes, starts, speaks, interrupts, and stops through the H5 SDK", async () => {
    const sdk = fakeDuixSdk();
    const client = await createDuixAvatarClient({
      loadSdk: async () => sdk.Constructor,
      readyTimeoutMs: 1000
    });
    const root = { id: "" } as HTMLElement;

    await client.start(connection, root);
    await client.speak("你好", true);
    client.interrupt();
    await client.exit();
    await client.exit();

    expect(root.id).toBe("duix-avatar-root");
    expect(sdk.instance.init).toHaveBeenCalledWith({
      sign: "jwt-sign",
      containerLable: "#duix-avatar-root"
    });
    expect(sdk.instance.start).toHaveBeenCalledWith({
      conversationId: "conv-1",
      muted: true,
      openAsr: false,
      wipeGreen: false
    });
    expect(sdk.instance.speak).toHaveBeenCalledWith({
      content: "你好",
      interrupt: true
    });
    expect(sdk.instance.break).toHaveBeenCalledOnce();
    expect(sdk.instance.stop).toHaveBeenCalledOnce();
  });

  it("rejects startup when required browser metadata is missing", async () => {
    const sdk = fakeDuixSdk();
    const client = await createDuixAvatarClient({
      loadSdk: async () => sdk.Constructor,
      readyTimeoutMs: 1000
    });

    await expect(
      client.start({ protocol: "webrtc", metadata: {} }, { id: "" } as HTMLElement)
    ).rejects.toThrow("DUIX_CONNECTION_INVALID");

    expect(sdk.instance.init).not.toHaveBeenCalled();
  });

  it("times out safely when SDK initialization never completes", async () => {
    vi.useFakeTimers();
    const sdk = fakeDuixSdk({ emitInitialSuccess: false });
    const client = await createDuixAvatarClient({
      loadSdk: async () => sdk.Constructor,
      readyTimeoutMs: 50
    });
    const pending = client
      .start(connection, { id: "" } as HTMLElement)
      .then(() => null, (error: Error) => error);

    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toMatchObject({
      message: "DUIX_AVATAR_READY_TIMEOUT"
    });
    expect(sdk.instance.stop).toHaveBeenCalledOnce();
  });
});

function fakeDuixSdk(options: { emitInitialSuccess?: boolean } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const instance = {
    init: vi.fn(async () => {
      if (options.emitInitialSuccess !== false) {
        queueMicrotask(() => {
          for (const listener of listeners.get("intialSucccess") ?? []) {
            listener();
          }
        });
      }
      return { err: "", data: "" };
    }),
    start: vi.fn(async () => ({ err: "", data: "duix-session-id" })),
    speak: vi.fn(async () => ({ err: "", data: "" })),
    break: vi.fn(),
    stop: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    })
  };
  const Constructor = vi.fn(() => instance);
  return { Constructor, instance };
}

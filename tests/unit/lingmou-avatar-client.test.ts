import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLingmouAvatarClient,
  type LingmouRtcConnection
} from "@/lib/client/lingmouAvatarClient";

const sdk = vi.hoisted(() => {
  const listeners = {
    error: undefined as ((error: unknown) => void) | undefined,
    firstFrame: undefined as (() => void) | undefined,
    ready: undefined as (() => void) | undefined
  };
  const avatar = {
    start: vi.fn(async () => undefined),
    pushAudioData: vi.fn(),
    interrupt: vi.fn(),
    exit: vi.fn(),
    onErrorReceived: vi.fn((listener: (error: unknown) => void) => {
      listeners.error = listener;
    }),
    onFirstFrameReceived: vi.fn((listener: () => void) => {
      listeners.firstFrame = listener;
    }),
    onReadyToSpeech: vi.fn((listener: () => void) => {
      listeners.ready = listener;
    }),
    off: vi.fn((event: string, listener: () => void) => {
      if (event === "ErrorReceived" && listeners.error === listener) {
        listeners.error = undefined;
      }
      if (event === "FirstFrameReceived" && listeners.firstFrame === listener) {
        listeners.firstFrame = undefined;
      }
      if (event === "ReadyToSpeech" && listeners.ready === listener) {
        listeners.ready = undefined;
      }
    })
  };
  return {
    avatar,
    CloudAvatar: vi.fn(() => avatar),
    TYVoiceChatMode: { tap2talk: "tap2talk" },
    IAvatarAudioFormat: { s16: "s16" },
    EventTypes: {
      ErrorReceived: "ErrorReceived",
      FirstFrameReceived: "FirstFrameReceived",
      ReadyToSpeech: "ReadyToSpeech"
    },
    emitError: (error: unknown) => listeners.error?.(error),
    emitFirstFrame: () => listeners.firstFrame?.(),
    emitReady: () => listeners.ready?.(),
    resetListeners: () => {
      listeners.error = undefined;
      listeners.firstFrame = undefined;
      listeners.ready = undefined;
    }
  };
});

vi.mock("lm-avatar-chat-sdk/cloud", () => ({
  CloudAvatar: sdk.CloudAvatar,
  TYVoiceChatMode: sdk.TYVoiceChatMode,
  IAvatarAudioFormat: sdk.IAvatarAudioFormat,
  EventTypes: sdk.EventTypes
}));

const connection: LingmouRtcConnection = {
  appId: "app-short-lived",
  avatarUserId: "avatar-user",
  channel: "rtc-channel",
  clientUserId: "client-user",
  serverUserId: "server-user",
  timestamp: 1_721_234_567,
  token: "short-lived-token",
  sessionId: "provider-session"
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sdk.resetListeners();
});

describe("createLingmouAvatarClient", () => {
  it("keeps the browser-safe RTC DTO physically separate from server credentials", () => {
    const dtoSource = readFileSync(
      resolve(process.cwd(), "lib/client/lingmouRtcConnection.ts"),
      "utf8"
    );
    const providerSource = readFileSync(
      resolve(process.cwd(), "lib/media/providers/lingmou.ts"),
      "utf8"
    );

    expect(providerSource).toContain(
      'from "@/lib/client/lingmouRtcConnection"'
    );
    expect(dtoSource).not.toMatch(
      /accessKeySecret|ttsApiKey|apiKeyCiphertext|credentialsCiphertext/
    );
  });

  it("refuses SSR use before constructing the browser SDK", async () => {
    vi.stubGlobal("window", undefined);

    await expect(createLingmouAvatarClient()).rejects.toThrow(
      "LINGMOU_BROWSER_REQUIRED"
    );
    expect(sdk.CloudAvatar).not.toHaveBeenCalled();
  });

  it("resolves start only after both ready-to-speech and first-frame events", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "navigator",
      new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "mediaDevices") {
              throw new Error("navigator.mediaDevices must not be accessed");
            }
            return undefined;
          }
        }
      )
    );
    const root = {} as HTMLVideoElement;

    const client = await createLingmouAvatarClient();
    const startPromise = client.start(connection, root);
    let settled = false;
    void startPromise.finally(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(sdk.avatar.start).toHaveBeenCalledOnce());

    expect(sdk.avatar.onReadyToSpeech).toHaveBeenCalledOnce();
    expect(sdk.avatar.onFirstFrameReceived).toHaveBeenCalledOnce();
    expect(sdk.avatar.onErrorReceived).toHaveBeenCalledOnce();
    expect(
      sdk.avatar.onReadyToSpeech.mock.invocationCallOrder[0]
    ).toBeLessThan(sdk.avatar.start.mock.invocationCallOrder[0]);
    expect(settled).toBe(false);

    sdk.emitReady();
    await Promise.resolve();
    expect(settled).toBe(false);

    sdk.emitFirstFrame();
    await startPromise;
    expect(settled).toBe(true);

    expect(sdk.CloudAvatar).toHaveBeenCalledWith({
      ...connection,
      rootContainer: root,
      ignoreAudioInput: true
    });
    expect(sdk.avatar.start).toHaveBeenCalledWith({
      mode: sdk.TYVoiceChatMode.tap2talk,
      keepAlive: true,
      avatarAudioFormat: sdk.IAvatarAudioFormat.s16,
      outboundSampleRate: 48_000
    });
    expect(sdk.avatar.off).toHaveBeenCalledTimes(3);
  });

  it("rejects an SDK error before readiness and cleans up the pending avatar", async () => {
    vi.stubGlobal("window", {});
    const client = await createLingmouAvatarClient();
    const startPromise = client.start(connection, {} as HTMLVideoElement);

    await vi.waitFor(() =>
      expect(sdk.avatar.onErrorReceived).toHaveBeenCalledOnce()
    );
    sdk.emitError(new Error("sensitive provider detail"));

    await expect(startPromise).rejects.toThrow("LINGMOU_AVATAR_START_FAILED");
    expect(sdk.avatar.exit).toHaveBeenCalledOnce();
    expect(sdk.avatar.off).toHaveBeenCalledTimes(3);
  });

  it("cancels pending readiness on exit and cleans up only once", async () => {
    vi.stubGlobal("window", {});
    const client = await createLingmouAvatarClient();
    const startPromise = client.start(connection, {} as HTMLVideoElement);

    await vi.waitFor(() => expect(sdk.avatar.start).toHaveBeenCalledOnce());
    client.exit();
    client.exit();

    await expect(startPromise).rejects.toThrow("LINGMOU_AVATAR_START_CANCELLED");
    expect(sdk.avatar.exit).toHaveBeenCalledOnce();
    expect(sdk.avatar.off).toHaveBeenCalledTimes(3);
  });

  it("times out when readiness events never arrive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    const client = await createLingmouAvatarClient();
    const startPromise = client.start(connection, {} as HTMLVideoElement);
    const timeoutExpectation = expect(startPromise).rejects.toThrow(
      "LINGMOU_AVATAR_READY_TIMEOUT"
    );

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);

    await timeoutExpectation;
    expect(sdk.avatar.exit).toHaveBeenCalledOnce();
    expect(sdk.avatar.off).toHaveBeenCalledTimes(3);
  });

  it("forwards PCM and makes interrupt and exit idempotent", async () => {
    vi.stubGlobal("window", {});
    const client = await createLingmouAvatarClient();
    const startPromise = client.start(connection, {} as HTMLVideoElement);
    await vi.waitFor(() => expect(sdk.avatar.start).toHaveBeenCalledOnce());
    sdk.emitReady();
    sdk.emitFirstFrame();
    await startPromise;
    const audio = Int16Array.from([1, -2]);

    client.pushPcm(audio, false);
    client.pushPcm(Int16Array.from([3]), true);
    client.interrupt();
    client.interrupt();
    client.exit();
    client.exit();

    expect(sdk.avatar.pushAudioData).toHaveBeenNthCalledWith(1, audio, false);
    expect(sdk.avatar.pushAudioData).toHaveBeenNthCalledWith(
      2,
      Int16Array.from([3]),
      true
    );
    expect(sdk.avatar.interrupt).toHaveBeenCalledOnce();
    expect(sdk.avatar.exit).toHaveBeenCalledOnce();
  });
});

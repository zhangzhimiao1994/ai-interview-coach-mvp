import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLingmouAvatarClient,
  type LingmouRtcConnection
} from "@/lib/client/lingmouAvatarClient";

const sdk = vi.hoisted(() => {
  const avatar = {
    start: vi.fn(async () => undefined),
    pushAudioData: vi.fn(),
    interrupt: vi.fn(),
    exit: vi.fn()
  };
  return {
    avatar,
    CloudAvatar: vi.fn(() => avatar),
    TYVoiceChatMode: { tap2talk: "tap2talk" },
    IAvatarAudioFormat: { s16: "s16" }
  };
});

vi.mock("lm-avatar-chat-sdk/cloud", () => ({
  CloudAvatar: sdk.CloudAvatar,
  TYVoiceChatMode: sdk.TYVoiceChatMode,
  IAvatarAudioFormat: sdk.IAvatarAudioFormat
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

  it("starts CloudAvatar with the exact audio-driven browser contract", async () => {
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
    const root = {} as HTMLElement;

    const client = await createLingmouAvatarClient();
    await client.start(connection, root);

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
  });

  it("forwards PCM and makes interrupt and exit idempotent", async () => {
    vi.stubGlobal("window", {});
    const client = await createLingmouAvatarClient();
    await client.start(connection, {} as HTMLElement);
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

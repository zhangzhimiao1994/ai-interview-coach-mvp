import type { LingmouRtcConnection } from "@/lib/client/lingmouRtcConnection";

export type { LingmouRtcConnection } from "@/lib/client/lingmouRtcConnection";

export interface LingmouAvatarClient {
  start(connection: LingmouRtcConnection, root: HTMLElement): Promise<void>;
  pushPcm(audio: Int16Array, end: boolean): void;
  interrupt(): void;
  exit(): void;
}

type CloudSdk = typeof import("lm-avatar-chat-sdk/cloud");
type AvatarInstance = InstanceType<CloudSdk["CloudAvatar"]>;

export async function createLingmouAvatarClient(): Promise<LingmouAvatarClient> {
  if (typeof window === "undefined") {
    throw new Error("LINGMOU_BROWSER_REQUIRED");
  }

  const sdk = await import("lm-avatar-chat-sdk/cloud");
  let avatar: AvatarInstance | null = null;
  let interrupted = false;
  let exited = false;

  return {
    async start(connection, root) {
      const nextAvatar = new sdk.CloudAvatar({
        appId: connection.appId,
        channel: connection.channel,
        timestamp: connection.timestamp,
        token: connection.token,
        clientUserId: connection.clientUserId,
        serverUserId: connection.serverUserId,
        avatarUserId: connection.avatarUserId,
        sessionId: connection.sessionId,
        rootContainer: root,
        ignoreAudioInput: true
      });
      avatar = nextAvatar;
      interrupted = false;
      exited = false;
      await nextAvatar.start({
        mode: sdk.TYVoiceChatMode.tap2talk,
        keepAlive: true,
        avatarAudioFormat: sdk.IAvatarAudioFormat.s16,
        outboundSampleRate: 48_000
      });
    },
    pushPcm(audio, end) {
      if (!avatar || exited) return;
      interrupted = false;
      avatar.pushAudioData(audio, end);
    },
    interrupt() {
      if (!avatar || exited || interrupted) return;
      interrupted = true;
      avatar.interrupt();
    },
    exit() {
      if (!avatar || exited) return;
      exited = true;
      avatar.exit();
    }
  };
}

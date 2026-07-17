import type { LingmouRtcConnection } from "@/lib/client/lingmouRtcConnection";

export type { LingmouRtcConnection } from "@/lib/client/lingmouRtcConnection";

export interface LingmouAvatarClient {
  start(
    connection: LingmouRtcConnection,
    root: HTMLVideoElement
  ): Promise<void>;
  pushPcm(audio: Int16Array, end: boolean): void;
  interrupt(): void;
  exit(): void;
}

type CloudSdk = typeof import("lm-avatar-chat-sdk/cloud");
type AvatarInstance = InstanceType<CloudSdk["CloudAvatar"]>;
type RuntimeAvatarEventEmitter = {
  off(event: string, listener: (...args: never[]) => void): unknown;
};

const AVATAR_READY_TIMEOUT_MS = 20_000;
const START_FAILURE_CODES = new Set([
  "LINGMOU_AVATAR_START_CANCELLED",
  "LINGMOU_AVATAR_START_FAILED",
  "LINGMOU_AVATAR_READY_TIMEOUT"
]);

function safeStartError(error: unknown): Error {
  if (error instanceof Error && START_FAILURE_CODES.has(error.message)) {
    return error;
  }
  return new Error("LINGMOU_AVATAR_START_FAILED");
}

export async function createLingmouAvatarClient(): Promise<LingmouAvatarClient> {
  if (typeof window === "undefined") {
    throw new Error("LINGMOU_BROWSER_REQUIRED");
  }

  const sdk = await import("lm-avatar-chat-sdk/cloud");
  let avatar: AvatarInstance | null = null;
  let interrupted = false;
  let exited = false;
  let cancelPendingStart: (() => void) | null = null;

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
      let readyToSpeech = false;
      let firstFrameReceived = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let resolveReadiness: () => void = () => undefined;
      let rejectReadiness: (error: Error) => void = () => undefined;

      const cleanupListeners = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        const eventEmitter = nextAvatar as unknown as RuntimeAvatarEventEmitter;
        eventEmitter.off(sdk.EventTypes.ReadyToSpeech, handleReadyToSpeech);
        eventEmitter.off(
          sdk.EventTypes.FirstFrameReceived,
          handleFirstFrameReceived
        );
        eventEmitter.off(sdk.EventTypes.ErrorReceived, handleErrorReceived);
        if (avatar === nextAvatar) {
          cancelPendingStart = null;
        }
      };
      const resolveIfReady = () => {
        if (settled || !readyToSpeech || !firstFrameReceived) return;
        settled = true;
        cleanupListeners();
        resolveReadiness();
      };
      const failReadiness = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        rejectReadiness(error);
      };
      function handleReadyToSpeech() {
        readyToSpeech = true;
        resolveIfReady();
      }
      function handleFirstFrameReceived() {
        firstFrameReceived = true;
        resolveIfReady();
      }
      function handleErrorReceived() {
        failReadiness(new Error("LINGMOU_AVATAR_START_FAILED"));
      }

      const readiness = new Promise<void>((resolve, reject) => {
        resolveReadiness = resolve;
        rejectReadiness = reject;
      });

      nextAvatar.onReadyToSpeech(handleReadyToSpeech);
      nextAvatar.onFirstFrameReceived(handleFirstFrameReceived);
      nextAvatar.onErrorReceived(handleErrorReceived);
      cancelPendingStart = () => {
        failReadiness(new Error("LINGMOU_AVATAR_START_CANCELLED"));
      };
      timeout = setTimeout(() => {
        failReadiness(new Error("LINGMOU_AVATAR_READY_TIMEOUT"));
      }, AVATAR_READY_TIMEOUT_MS);

      try {
        await Promise.all([
          nextAvatar.start({
            mode: sdk.TYVoiceChatMode.tap2talk,
            keepAlive: true,
            avatarAudioFormat: sdk.IAvatarAudioFormat.s16,
            outboundSampleRate: 48_000
          }),
          readiness
        ]);
      } catch (error) {
        const safeError = safeStartError(error);
        failReadiness(safeError);
        if (!exited && avatar === nextAvatar) {
          exited = true;
          nextAvatar.exit();
        }
        throw safeError;
      }
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
      cancelPendingStart?.();
      avatar.exit();
    }
  };
}

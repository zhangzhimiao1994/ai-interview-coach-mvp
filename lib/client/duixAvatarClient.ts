import type { DigitalHumanConnection } from "@/lib/media/types";

export interface DuixAvatarClient {
  start(connection: DigitalHumanConnection, root: HTMLElement): Promise<void>;
  speak(text: string, interrupt: boolean): Promise<void>;
  interrupt(): void;
  exit(): Promise<void>;
}

type DuixReturn = { err?: unknown; data?: unknown } | void;
type DuixRuntime = {
  init(option: { sign: string; containerLable: string }): Promise<DuixReturn>;
  start(option: {
    conversationId: string;
    muted: boolean;
    openAsr: boolean;
    wipeGreen: boolean;
  }): Promise<DuixReturn>;
  speak(option: { content: string; interrupt: boolean }): Promise<DuixReturn>;
  break?: () => unknown;
  stop: () => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};
type DuixConstructor = new () => DuixRuntime;

type DuixAvatarClientOptions = {
  loadSdk?: () => Promise<DuixConstructor>;
  readyTimeoutMs?: number;
};

const defaultReadyTimeoutMs = 20_000;
const rootId = "duix-avatar-root";

async function defaultLoadSdk(): Promise<DuixConstructor> {
  const sdkModule = await import("duix-guiji");
  return (sdkModule.default ?? sdkModule) as DuixConstructor;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function metadata(connection: DigitalHumanConnection) {
  const values = connection.metadata ?? {};
  const sign = text(values.sign);
  const conversationId = text(values.conversationId);
  if (
    connection.protocol !== "webrtc" ||
    values.adapter !== "DUIX_H5_SDK" ||
    !sign ||
    !conversationId
  ) {
    throw new Error("DUIX_CONNECTION_INVALID");
  }
  return { sign, conversationId };
}

function assertSdkResult(result: DuixReturn, code: string) {
  if (result && typeof result === "object" && "err" in result && result.err) {
    throw new Error(code);
  }
}

export async function createDuixAvatarClient(
  options: DuixAvatarClientOptions = {}
): Promise<DuixAvatarClient> {
  if (typeof window === "undefined") {
    throw new Error("DUIX_BROWSER_REQUIRED");
  }

  const Duix = await (options.loadSdk ?? defaultLoadSdk)();
  const duix = new Duix();
  const readyTimeoutMs = options.readyTimeoutMs ?? defaultReadyTimeoutMs;
  let started = false;
  let exited = false;
  let cancelPendingStart: (() => void) | null = null;

  async function exit() {
    if (exited) return;
    exited = true;
    cancelPendingStart?.();
    cancelPendingStart = null;
    await Promise.resolve(duix.stop());
  }

  return {
    async start(connection, root) {
      const { sign, conversationId } = metadata(connection);
      if (!root.id) root.id = rootId;
      const selector = `#${root.id}`;

      let timeout: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let resolveReady: () => void = () => undefined;
      let rejectReady: (error: Error) => void = () => undefined;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        cancelPendingStart = null;
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectReady(error);
      };
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      void ready.catch(() => undefined);

      duix.on("intialSucccess", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveReady();
      });
      duix.on("error", () => fail(new Error("DUIX_AVATAR_START_FAILED")));
      cancelPendingStart = () => fail(new Error("DUIX_AVATAR_START_CANCELLED"));
      timeout = setTimeout(
        () => fail(new Error("DUIX_AVATAR_READY_TIMEOUT")),
        readyTimeoutMs
      );

      try {
        assertSdkResult(
          await duix.init({ sign, containerLable: selector }),
          "DUIX_AVATAR_INIT_FAILED"
        );
        await ready;
        assertSdkResult(
          await duix.start({
            conversationId,
            muted: true,
            openAsr: false,
            wipeGreen: false
          }),
          "DUIX_AVATAR_START_FAILED"
        );
        started = true;
        exited = false;
      } catch (error) {
        await exit();
        throw error;
      }
    },

    async speak(content, interrupt) {
      if (!started || exited) return;
      assertSdkResult(
        await duix.speak({ content, interrupt }),
        "DUIX_AVATAR_SPEAK_FAILED"
      );
    },

    interrupt() {
      if (!started || exited) return;
      duix.break?.();
    },

    exit
  };
}

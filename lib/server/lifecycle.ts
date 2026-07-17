type ShutdownStep =
  | "REAPER_STOP"
  | "WEBSOCKET_CLOSE"
  | "HTTP_CLOSE"
  | "CLOUD_SESSION_CLOSE"
  | "APP_CLOSE";

export type ServerShutdownDependencies = {
  stopReaper: () => unknown | Promise<unknown>;
  closeWebSockets: () => void | Promise<void>;
  stopHttpAccept: () => void | Promise<void>;
  stopCloudSessions: () => void | Promise<void>;
  closeApp: () => void | Promise<void>;
  warn: (code: string) => void;
  timeoutMs?: number;
};

const defaultShutdownStepTimeoutMs = 5_000;

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export type ShutdownSignalRegistrar = {
  on: (signal: ShutdownSignal, listener: () => void) => void;
  off: (signal: ShutdownSignal, listener: () => void) => void;
};

export type ServerShutdownSignalDependencies = {
  shutdown: () => Promise<void>;
  exit: (code: number) => void;
  registrar?: ShutdownSignalRegistrar;
};

const processSignalRegistrar: ShutdownSignalRegistrar = {
  on(signal, listener) {
    process.on(signal, listener);
  },
  off(signal, listener) {
    process.off(signal, listener);
  }
};

export function registerServerShutdownSignals(
  deps: ServerShutdownSignalDependencies
) {
  const registrar = deps.registrar ?? processSignalRegistrar;
  let pending: Promise<void> | null = null;

  const handleSignal = () => {
    if (pending) return;

    try {
      pending = deps.shutdown();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending = pending.finally(() => {
        registrar.off("SIGINT", handleSignal);
        registrar.off("SIGTERM", handleSignal);
        deps.exit(0);
      });
    void pending.catch(() => undefined);
  };

  registrar.on("SIGINT", handleSignal);
  registrar.on("SIGTERM", handleSignal);
}

async function runBoundedStep(
  step: ShutdownStep,
  action: () => unknown | Promise<unknown>,
  timeoutMs: number,
  warn: (code: string) => void
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    Promise.resolve()
      .then(action)
      .then(() => "COMPLETE" as const)
      .catch(() => "FAILED" as const),
    new Promise<"TIMEOUT">((resolve) => {
      timeout = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    })
  ]);

  if (timeout) clearTimeout(timeout);
  if (outcome !== "COMPLETE") {
    warn(`SERVER_${step}_${outcome}`);
  }
}

export function createServerShutdown(deps: ServerShutdownDependencies) {
  let pending: Promise<void> | null = null;
  const timeoutMs = deps.timeoutMs ?? defaultShutdownStepTimeoutMs;

  return function shutdown() {
    if (pending) return pending;

    pending = (async () => {
      await runBoundedStep(
        "REAPER_STOP",
        deps.stopReaper,
        timeoutMs,
        deps.warn
      );

      await runBoundedStep(
        "WEBSOCKET_CLOSE",
        deps.closeWebSockets,
        timeoutMs,
        deps.warn
      );
      await runBoundedStep(
        "HTTP_CLOSE",
        deps.stopHttpAccept,
        timeoutMs,
        deps.warn
      );
      await runBoundedStep(
        "CLOUD_SESSION_CLOSE",
        deps.stopCloudSessions,
        timeoutMs,
        deps.warn
      );
      await runBoundedStep(
        "APP_CLOSE",
        deps.closeApp,
        timeoutMs,
        deps.warn
      );
    })();

    return pending;
  };
}

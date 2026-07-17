type ShutdownStep =
  | "WEBSOCKET_CLOSE"
  | "HTTP_CLOSE"
  | "CLOUD_SESSION_CLOSE"
  | "APP_CLOSE";

export type ServerShutdownDependencies = {
  stopReaper: () => void;
  closeWebSockets: () => void | Promise<void>;
  stopHttpAccept: () => void | Promise<void>;
  stopCloudSessions: () => void | Promise<void>;
  closeApp: () => void | Promise<void>;
  warn: (code: string) => void;
  timeoutMs?: number;
};

const defaultShutdownStepTimeoutMs = 5_000;

async function runBoundedStep(
  step: ShutdownStep,
  action: () => void | Promise<void>,
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
      timeout.unref?.();
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
      try {
        deps.stopReaper();
      } catch {
        deps.warn("SERVER_REAPER_STOP_FAILED");
      }

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

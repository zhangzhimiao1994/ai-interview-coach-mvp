import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRealtimeUpgradeHandler } from "@/lib/realtime/upgradeRouter";
import {
  createServerShutdown,
  registerServerShutdownSignals,
  type ShutdownSignal
} from "@/lib/server/lifecycle";

describe("realtime WebSocket upgrade routing", () => {
  it("keeps Next.js upgrades available outside the ASR endpoint", async () => {
    const nextUpgradeHandler = vi.fn().mockResolvedValue(undefined);
    const webSocketServer = { handleUpgrade: vi.fn() };
    const handler = createRealtimeUpgradeHandler({
      nextUpgradeHandler,
      webSocketServer,
      onAsrConnection: vi.fn()
    });
    const request = { url: "/_next/webpack-hmr?page=/" };
    const socket = {};
    const head = Buffer.alloc(0);

    await handler(request as never, socket as never, head);

    expect(nextUpgradeHandler).toHaveBeenCalledWith(request, socket, head);
    expect(webSocketServer.handleUpgrade).not.toHaveBeenCalled();
  });

  it("accepts only the same-process ASR WebSocket endpoint", async () => {
    const client = { close: vi.fn() };
    const nextUpgradeHandler = vi.fn().mockResolvedValue(undefined);
    const onAsrConnection = vi.fn();
    const webSocketServer = {
      handleUpgrade: vi.fn((_request, _socket, _head, done) => done(client))
    };
    const handler = createRealtimeUpgradeHandler({
      nextUpgradeHandler,
      webSocketServer,
      onAsrConnection
    });
    const request = { url: "/ws/asr?ticket=one-time-ticket" };

    await handler(request as never, {} as never, Buffer.alloc(0));

    expect(webSocketServer.handleUpgrade).toHaveBeenCalledOnce();
    expect(onAsrConnection).toHaveBeenCalledWith(client, request);
    expect(nextUpgradeHandler).not.toHaveBeenCalled();
  });
});

describe("server shutdown lifecycle", () => {
  it("recovers startup sessions and reaps idle, expired, and due FAILED cloud sessions", async () => {
    vi.resetModules();
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 4 });
    const drainProviderSessionCloseRecoveries = vi.fn().mockResolvedValue(0);
    vi.doMock("@/lib/db/prisma", () => ({
      prisma: { digitalHumanSession: { findMany, updateMany } }
    }));
    vi.doMock("@/lib/media/providerSessionCloseRecoveries", () => ({
      drainProviderSessionCloseRecoveries,
      enqueueProviderSessionCloseRecovery: vi.fn()
    }));
    const unref = vi.fn();
    const interval = { unref } as unknown as ReturnType<typeof setInterval>;
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(interval);
    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => undefined);
    const now = new Date("2026-07-18T02:00:00.000Z");
    const {
      recoverDigitalHumanSessionsAfterStartup,
      startDigitalHumanSessionReaper
    } = await import(
      "@/lib/media/digitalHumanSessions"
    );

    await expect(recoverDigitalHumanSessionsAfterStartup(now)).resolves.toBe(4);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        mode: "LINGMOU_CLOUD",
        status: { in: ["CONNECTING", "READY", "SPEAKING", "STOPPING"] }
      },
      data: {
        status: "FAILED",
        endedAt: now,
        stopReason: "PROCESS_RESTART"
      }
    });

    const stop = startDigitalHumanSessionReaper({ now: () => now });
    const tick = setIntervalSpy.mock.calls[0]?.[0] as () => void;
    tick();
    await vi.waitFor(() => expect(findMany).toHaveBeenCalledTimes(2));

    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(30_000);
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {
        mode: "LINGMOU_CLOUD",
        status: {
          in: ["CONNECTING", "READY", "SPEAKING", "STOPPING", "FAILED"]
        },
        providerId: { not: null },
        providerSessionId: { not: null },
        instanceId: { not: null },
        OR: [
          {
            status: { in: ["READY", "SPEAKING"] },
            lastActivityAt: { lt: new Date(now.getTime() - 60_000) }
          },
          { expiresAt: { lte: now } },
          {
            status: "FAILED",
            updatedAt: { lte: new Date(now.getTime() - 30_000) }
          }
        ]
      },
      orderBy: { updatedAt: "asc" }
    });
    expect(drainProviderSessionCloseRecoveries).toHaveBeenCalledWith(now);
    expect(unref).toHaveBeenCalledOnce();
    await stop();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.doUnmock("@/lib/db/prisma");
    vi.doUnmock("@/lib/media/providerSessionCloseRecoveries");
  });

  it("drains an active reaper tick before permitting a restarted interval", async () => {
    vi.resetModules();
    let finishFind!: (rows: never[]) => void;
    const findMany = vi.fn(
      () => new Promise<never[]>((resolve) => { finishFind = resolve; })
    );
    vi.doMock("@/lib/db/prisma", () => ({
      prisma: { digitalHumanSession: { findMany } }
    }));
    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation((handler) => {
        intervalCallbacks.push(handler as () => void);
        return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
      });
    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => undefined);
    const { startDigitalHumanSessionReaper } = await import(
      "@/lib/media/digitalHumanSessions"
    );

    const drainRecoveries = vi.fn().mockResolvedValue(0);
    const stopFirst = startDigitalHumanSessionReaper({ drainRecoveries });
    intervalCallbacks[0]?.();
    await vi.waitFor(() => expect(findMany).toHaveBeenCalledOnce());
    const drain = stopFirst();
    const stopDuringDrain = startDigitalHumanSessionReaper({ drainRecoveries });
    const restartWasCoalesced = stopDuringDrain === stopFirst;
    const intervalsBeforeRelease = intervalCallbacks.length;
    let drainSettled = false;
    const trackedDrain = Promise.resolve(drain).then(() => {
      drainSettled = true;
    });
    await Promise.resolve();
    const settledBeforeRelease = drainSettled;
    void stopDuringDrain();

    finishFind([]);
    await trackedDrain;
    const stopAfterDrain = startDigitalHumanSessionReaper({ drainRecoveries });
    const restartAfterDrainWasNew = stopAfterDrain !== stopFirst;
    await stopAfterDrain();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.doUnmock("@/lib/db/prisma");

    expect(restartWasCoalesced).toBe(true);
    expect(intervalsBeforeRelease).toBe(1);
    expect(settledBeforeRelease).toBe(false);
    expect(restartAfterDrainWasNew).toBe(true);
    expect(intervalCallbacks).toHaveLength(2);
  });

  it("wires startup recovery and the reaper before accepting HTTP traffic", () => {
    const source = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const recovery = source.indexOf("recoverDigitalHumanSessionsAfterStartup(");
    const queueDrain = source.indexOf("drainProviderSessionCloseRecoveries(");
    const reaper = source.indexOf("startDigitalHumanSessionReaper(");
    const listen = source.indexOf("server.listen(");

    expect(recovery).toBeGreaterThan(-1);
    expect(queueDrain).toBeGreaterThan(recovery);
    expect(reaper).toBeGreaterThan(queueDrain);
    expect(listen).toBeGreaterThan(reaper);
    expect(source).toContain("stopAllActiveDigitalHumanSessions(\"SERVER_SHUTDOWN\")");
    expect(source).toContain("drainPendingCloses");
  });

  it("stops the reaper before WebSocket, HTTP, cloud-session, and app cleanup", async () => {
    const order: string[] = [];
    const shutdown = createServerShutdown({
      stopReaper: () => order.push("reaper"),
      closeWebSockets: async () => { order.push("websocket"); },
      stopHttpAccept: async () => { order.push("http"); },
      stopCloudSessions: async () => { order.push("cloud"); },
      drainPendingCloses: async () => { order.push("recovery"); },
      closeApp: async () => { order.push("app"); },
      warn: vi.fn(),
      timeoutMs: 100
    });

    await Promise.all([shutdown(), shutdown()]);

    expect(order).toEqual([
      "reaper",
      "websocket",
      "http",
      "cloud",
      "recovery",
      "app"
    ]);
  });

  it("keeps both signal handlers installed and reuses cleanup across repeated signals", async () => {
    const listeners: Record<ShutdownSignal, Set<() => void>> = {
      SIGINT: new Set(),
      SIGTERM: new Set()
    };
    const registrar = {
      on: vi.fn((signal: ShutdownSignal, listener: () => void) => {
        listeners[signal].add(listener);
      }),
      off: vi.fn((signal: ShutdownSignal, listener: () => void) => {
        listeners[signal].delete(listener);
      })
    };
    const emit = (signal: ShutdownSignal) => {
      for (const listener of listeners[signal]) listener();
    };
    let finishShutdown!: () => void;
    const shutdown = vi.fn(
      () => new Promise<void>((resolve) => { finishShutdown = resolve; })
    );
    const exit = vi.fn();

    registerServerShutdownSignals({ registrar, shutdown, exit });
    emit("SIGINT");
    emit("SIGINT");
    emit("SIGTERM");

    expect(shutdown).toHaveBeenCalledOnce();
    expect(registrar.off).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    finishShutdown();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(registrar.off).toHaveBeenCalledTimes(2);
    expect(listeners.SIGINT.size).toBe(0);
    expect(listeners.SIGTERM.size).toBe(0);
    emit("SIGINT");
    emit("SIGTERM");
    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("continues cleanup after failures and bounds a hanging shutdown step", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const warn = vi.fn();
    const shutdown = createServerShutdown({
      stopReaper: () => order.push("reaper"),
      closeWebSockets: () => new Promise<void>(() => undefined),
      stopHttpAccept: async () => {
        order.push("http");
        throw new Error("raw socket secret sentinel");
      },
      stopCloudSessions: async () => { order.push("cloud"); },
      closeApp: async () => { order.push("app"); },
      warn,
      timeoutMs: 25
    });

    const pending = shutdown();
    await vi.advanceTimersByTimeAsync(25);
    await pending;

    expect(order).toEqual(["reaper", "http", "cloud", "app"]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret sentinel");
    expect(warn).toHaveBeenCalledWith("SERVER_WEBSOCKET_CLOSE_TIMEOUT");
    expect(warn).toHaveBeenCalledWith("SERVER_HTTP_CLOSE_FAILED");
    vi.useRealTimers();
  });

  it("keeps the real shutdown watchdog referenced until a hanging phase times out", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((handler, timeout, ...args) => {
        const timer = originalSetTimeout(handler, timeout, ...args);
        watchdog ??= timer;
        return timer;
      });
    const warn = vi.fn();
    const closeApp = vi.fn().mockResolvedValue(undefined);
    const shutdown = createServerShutdown({
      stopReaper: vi.fn(),
      closeWebSockets: () => new Promise<void>(() => undefined),
      stopHttpAccept: vi.fn().mockResolvedValue(undefined),
      stopCloudSessions: vi.fn().mockResolvedValue(undefined),
      closeApp,
      warn,
      timeoutMs: 10
    });

    const pending = shutdown();
    const watchdogWasReferenced = watchdog?.hasRef();
    await pending;
    setTimeoutSpy.mockRestore();

    expect(watchdogWasReferenced).toBe(true);
    expect(warn).toHaveBeenCalledWith("SERVER_WEBSOCKET_CLOSE_TIMEOUT");
    expect(closeApp).toHaveBeenCalledOnce();
  });
});

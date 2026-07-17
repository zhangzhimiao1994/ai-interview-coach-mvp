import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRealtimeUpgradeHandler } from "@/lib/realtime/upgradeRouter";
import { createServerShutdown } from "@/lib/server/lifecycle";

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
  it("reaps only cloud sessions idle for 60 seconds on a 30-second interval", async () => {
    vi.resetModules();
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 4 });
    vi.doMock("@/lib/db/prisma", () => ({
      prisma: { digitalHumanSession: { findMany, updateMany } }
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
      failUnrecoverableDigitalHumanSessions,
      startDigitalHumanSessionReaper
    } = await import(
      "@/lib/media/digitalHumanSessions"
    );

    await expect(failUnrecoverableDigitalHumanSessions(now)).resolves.toBe(4);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
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
    await vi.waitFor(() => expect(findMany).toHaveBeenCalledOnce());

    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(30_000);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        mode: "LINGMOU_CLOUD",
        status: { in: ["READY", "SPEAKING"] },
        lastActivityAt: { lt: new Date(now.getTime() - 60_000) }
      },
      orderBy: { lastActivityAt: "asc" }
    });
    expect(unref).toHaveBeenCalledOnce();
    stop();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.doUnmock("@/lib/db/prisma");
  });

  it("wires startup recovery and the reaper before accepting HTTP traffic", () => {
    const source = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const recovery = source.indexOf("failUnrecoverableDigitalHumanSessions(");
    const reaper = source.indexOf("startDigitalHumanSessionReaper(");
    const listen = source.indexOf("server.listen(");

    expect(recovery).toBeGreaterThan(-1);
    expect(reaper).toBeGreaterThan(recovery);
    expect(listen).toBeGreaterThan(reaper);
    expect(source).toContain("stopAllActiveDigitalHumanSessions(\"SERVER_SHUTDOWN\")");
  });

  it("stops the reaper before WebSocket, HTTP, cloud-session, and app cleanup", async () => {
    const order: string[] = [];
    const shutdown = createServerShutdown({
      stopReaper: () => order.push("reaper"),
      closeWebSockets: async () => { order.push("websocket"); },
      stopHttpAccept: async () => { order.push("http"); },
      stopCloudSessions: async () => { order.push("cloud"); },
      closeApp: async () => { order.push("app"); },
      warn: vi.fn(),
      timeoutMs: 100
    });

    await Promise.all([shutdown(), shutdown()]);

    expect(order).toEqual(["reaper", "websocket", "http", "cloud", "app"]);
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
});

import { describe, expect, it, vi } from "vitest";
import { createRealtimeUpgradeHandler } from "@/lib/realtime/upgradeRouter";

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

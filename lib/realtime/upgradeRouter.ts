import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";

type UpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) => void | Promise<void>;

type RealtimeUpgradeDependencies = {
  nextUpgradeHandler: UpgradeHandler;
  webSocketServer: Pick<WebSocketServer, "handleUpgrade">;
  onAsrConnection: (client: WebSocket, request: IncomingMessage) => void;
};

export function createRealtimeUpgradeHandler({
  nextUpgradeHandler,
  webSocketServer,
  onAsrConnection
}: RealtimeUpgradeDependencies): UpgradeHandler {
  return async (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname !== "/ws/asr") {
      await nextUpgradeHandler(request, socket, head);
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      onAsrConnection(client, request);
    });
  };
}

import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { handleAsrConnection } from "@/lib/realtime/asrGateway";
import { createRealtimeUpgradeHandler } from "@/lib/realtime/upgradeRouter";

function readPort(value: string | undefined) {
  const port = Number(value ?? "3000");

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

async function main() {
  const dev = process.argv.includes("--dev");
  const hostname = process.env.HOSTNAME?.trim() || "0.0.0.0";
  const port = readPort(process.env.PORT);
  const app = next({ dev, hostname, port });

  await app.prepare();

  const requestHandler = app.getRequestHandler();
  const nextUpgradeHandler = app.getUpgradeHandler();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 96 * 1024
  });
  const server = createServer((request, response) => {
    void requestHandler(request, response).catch((error: unknown) => {
      console.error("HTTP request failed", error);

      if (!response.headersSent) {
        response.statusCode = 500;
        response.end("Internal server error");
      } else {
        response.destroy();
      }
    });
  });
  const upgradeHandler = createRealtimeUpgradeHandler({
    nextUpgradeHandler,
    webSocketServer,
    onAsrConnection(client, request) {
      void handleAsrConnection(client, request);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    void Promise.resolve(upgradeHandler(request, socket, head)).catch((error: unknown) => {
      console.error("WebSocket upgrade failed", error);
      socket.destroy();
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    webSocketServer.clients.forEach((client) => client.close(1001, "Server shutting down"));
    webSocketServer.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await app.close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  server.listen(port, hostname, () => {
    console.log(`AI Interview Coach listening on http://${hostname}:${port}`);
  });
}

void main().catch((error: unknown) => {
  console.error("Unable to start AI Interview Coach", error);
  process.exit(1);
});

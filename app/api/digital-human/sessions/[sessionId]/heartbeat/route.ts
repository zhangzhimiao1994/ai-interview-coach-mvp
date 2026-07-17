import { NextResponse } from "next/server";
import {
  DigitalHumanSessionError,
  heartbeatDigitalHumanSession
} from "@/lib/media/digitalHumanSessions";

type RouteContext = { params: Promise<{ sessionId: string }> };
type HeartbeatDependencies = {
  heartbeat: (id: string) => Promise<void>;
};

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function errorResponse(error: unknown) {
  if (error instanceof DigitalHumanSessionError) {
    return noStoreJson(
      {
        error: "Digital human session request failed",
        reasonCode: error.code
      },
      error.status
    );
  }
  return noStoreJson({ error: "Internal server error" }, 500);
}

export function createDigitalHumanSessionHeartbeatHandler(
  overrides: Partial<HeartbeatDependencies> = {}
) {
  const deps: HeartbeatDependencies = {
    heartbeat: heartbeatDigitalHumanSession,
    ...overrides
  };

  return async function handleHeartbeat(_request: Request, context: RouteContext) {
    try {
      const id = (await context.params).sessionId.trim();
      if (!id) return noStoreJson({ error: "Session is required" }, 400);
      await deps.heartbeat(id);
      return noStoreJson({ ok: true }, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createDigitalHumanSessionHeartbeatHandler();

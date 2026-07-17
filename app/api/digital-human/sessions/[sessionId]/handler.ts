import { NextResponse } from "next/server";
import {
  DigitalHumanSessionError,
  stopDigitalHumanSession
} from "@/lib/media/digitalHumanSessions";

type RouteContext = { params: Promise<{ sessionId: string }> };
type DeleteDependencies = {
  stop: (id: string, reason: string) => Promise<void>;
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

export function createDigitalHumanSessionDeleteHandler(
  overrides: Partial<DeleteDependencies> = {}
) {
  const deps: DeleteDependencies = {
    stop: stopDigitalHumanSession,
    ...overrides
  };

  return async function handleDelete(_request: Request, context: RouteContext) {
    try {
      const id = (await context.params).sessionId.trim();
      if (!id) return noStoreJson({ error: "Session is required" }, 400);
      await deps.stop(id, "CLIENT_EXIT");
      return noStoreJson({ ok: true }, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DigitalHumanSessionError,
  downgradeDigitalHumanSession,
  type PublicDigitalHumanSession
} from "@/lib/media/digitalHumanSessions";

type RouteContext = { params: Promise<{ sessionId: string }> };

type DowngradeDependencies = {
  downgrade: (
    id: string,
    reasonCode: string
  ) => Promise<PublicDigitalHumanSession>;
};

const downgradeSchema = z.object({
  reasonCode: z.string().trim().regex(/^[A-Z0-9_.-]{1,100}$/)
}).strict();

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
  if (error instanceof z.ZodError) {
    return noStoreJson({ error: "Validation failed", issues: error.issues }, 400);
  }
  if (error instanceof SyntaxError) {
    return noStoreJson({ error: "Invalid JSON" }, 400);
  }
  return noStoreJson({ error: "Internal server error" }, 500);
}

export function createDigitalHumanSessionDowngradeHandler(
  overrides: Partial<DowngradeDependencies> = {}
) {
  const deps: DowngradeDependencies = {
    downgrade: downgradeDigitalHumanSession,
    ...overrides
  };

  return async function handleDowngrade(
    request: Request,
    context: RouteContext
  ) {
    try {
      const id = (await context.params).sessionId.trim();
      if (!id) return noStoreJson({ error: "Session is required" }, 400);
      const input = downgradeSchema.parse(await request.json());
      const session = await deps.downgrade(id, input.reasonCode);
      return noStoreJson({ session }, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createDigitalHumanSession,
  DigitalHumanSessionError,
  type PublicDigitalHumanSession
} from "@/lib/media/digitalHumanSessions";

const createSessionSchema = z
  .object({
    trainingSessionId: z.string().trim().min(1).max(200)
  })
  .strict();

type CreateSessionDependencies = {
  createSession: (
    trainingSessionId: string
  ) => Promise<PublicDigitalHumanSession>;
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
  if (error instanceof z.ZodError) {
    return noStoreJson({ error: "Validation failed", issues: error.issues }, 400);
  }
  if (error instanceof SyntaxError) {
    return noStoreJson({ error: "Invalid JSON" }, 400);
  }
  return noStoreJson({ error: "Internal server error" }, 500);
}

export function createDigitalHumanSessionCreateHandler(
  overrides: Partial<CreateSessionDependencies> = {}
) {
  const deps: CreateSessionDependencies = {
    createSession: createDigitalHumanSession,
    ...overrides
  };

  return async function handleCreateDigitalHumanSession(request: Request) {
    try {
      const input = createSessionSchema.parse(await request.json());
      const session = await deps.createSession(input.trainingSessionId);
      return noStoreJson({ session }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

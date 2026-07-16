import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiConfigSecretMissingError } from "@/lib/domain/aiServices";
import { AiProviderError } from "@/lib/ai/errors";

export class ApiConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConflictError";
  }
}

function isJsonParseError(error: unknown) {
  return error instanceof SyntaxError;
}

function prismaErrorCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code
    : null;
}

export function postErrorResponse(error: unknown) {
  if (error instanceof AiProviderError) {
    return NextResponse.json(
      {
        error: "AI service unavailable",
        message: "The selected AI service failed to return a valid response. Please retry shortly."
      },
      { status: 502 }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
  }

  if (isJsonParseError(error)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (error instanceof ApiConflictError) {
    return NextResponse.json(
      { error: "Conflict", message: error.message },
      { status: 409 }
    );
  }

  const prismaCode = prismaErrorCode(error);

  if (prismaCode === "P2002") {
    return NextResponse.json(
      { error: "Conflict", message: "A conflicting record already exists." },
      { status: 409 }
    );
  }

  if (prismaCode === "P2003") {
    return NextResponse.json(
      { error: "Invalid reference", message: "One or more referenced records do not exist." },
      { status: 400 }
    );
  }

  if (prismaCode === "P2025") {
    return NextResponse.json(
      { error: "Not found", message: "The requested record does not exist." },
      { status: 404 }
    );
  }

  if (error instanceof AiConfigSecretMissingError) {
    return NextResponse.json(
      {
        error: "AI service encryption is not configured",
        message:
          "AI_CONFIG_SECRET is missing. Set AI_CONFIG_SECRET in .env before saving provider API keys."
      },
      { status: 400 }
    );
  }

  if (error instanceof Error && error.message.includes("AI_CONFIG_SECRET must be changed")) {
    return NextResponse.json(
      {
        error: "AI service encryption is not safe",
        message: "AI_CONFIG_SECRET is still using the production placeholder. Set a unique secret before saving API keys."
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

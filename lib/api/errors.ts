import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiConfigSecretMissingError } from "@/lib/domain/aiServices";

function isJsonParseError(error: unknown) {
  return error instanceof SyntaxError;
}

function isPrismaReferenceError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2025");
}

export function postErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
  }

  if (isJsonParseError(error)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (isPrismaReferenceError(error)) {
    return NextResponse.json(
      { error: "Invalid reference", message: "One or more referenced records do not exist." },
      { status: 400 }
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

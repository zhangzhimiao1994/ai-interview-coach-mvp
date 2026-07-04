import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

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

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

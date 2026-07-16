import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;

    return NextResponse.json(
      { status: "ready", checks: { database: "up" } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", checks: { database: "down" } },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

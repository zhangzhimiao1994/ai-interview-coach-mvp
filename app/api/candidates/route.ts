import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { parseCandidateInput } from "@/lib/validators/candidate";

export async function GET() {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ candidates });
}

export async function POST(request: Request) {
  try {
    const input = parseCandidateInput(await request.json());
    const candidate = await prisma.candidate.create({
      data: input
    });

    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}

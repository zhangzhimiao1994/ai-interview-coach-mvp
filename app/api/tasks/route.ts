import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { parseTrainingTaskInput } from "@/lib/validators/task";

const taskIncludes = {
  candidate: true,
  companyTemplate: true,
  jobTemplate: true,
  interviewerTemplate: true
} satisfies Prisma.TrainingTaskInclude;

export async function GET() {
  const tasks = await prisma.trainingTask.findMany({
    include: taskIncludes,
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  try {
    const input = parseTrainingTaskInput(await request.json());
    const task = await prisma.trainingTask.create({
      data: input,
      include: taskIncludes
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}

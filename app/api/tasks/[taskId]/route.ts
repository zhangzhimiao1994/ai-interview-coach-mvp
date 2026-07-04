import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      companyTemplate: true,
      jobTemplate: true,
      interviewerTemplate: true,
      sessions: {
        include: {
          report: true
        },
        orderBy: { startedAt: "desc" }
      }
    }
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}

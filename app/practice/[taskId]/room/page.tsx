import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InterviewRoom } from "@/components/practice/InterviewRoom";
import { prisma } from "@/lib/db/prisma";
import { buildStagePlan, parseStageConfigInput } from "@/lib/domain/stages";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function PracticeRoomPage({ params }: PageProps) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId }
  });

  if (!task) {
    notFound();
  }

  const stages = buildStagePlan(parseStageConfigInput(task.stageConfig));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link className="text-sm font-medium text-brand" href={`/practice/${task.id}` as Route}>
        Practice entry
      </Link>
      <div className="mt-4">
        <InterviewRoom taskId={task.id} taskTitle={task.title} stages={stages} />
      </div>
    </main>
  );
}

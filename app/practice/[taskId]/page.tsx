import Link from "next/link";
import { notFound } from "next/navigation";
import { PracticeEntry } from "@/components/practice/PracticeEntry";
import { prisma } from "@/lib/db/prisma";
import { buildStagePlan, parseStageConfigInput } from "@/lib/domain/stages";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function PracticePage({ params }: PageProps) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      interviewerTemplate: true
    }
  });

  if (!task) {
    notFound();
  }

  const stages = buildStagePlan(parseStageConfigInput(task.stageConfig));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link className="text-sm font-medium text-brand" href="/">
        Home
      </Link>
      <div className="mt-4">
        <PracticeEntry
          task={{
            id: task.id,
            title: task.title,
            targetCompany: task.targetCompany,
            targetRole: task.targetRole,
            expectedMinutes: task.expectedMinutes,
            candidateName: task.candidate.name,
            interviewerName: task.interviewerTemplate?.name || "Default interviewer"
          }}
          stages={stages}
        />
      </div>
    </main>
  );
}

import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CandidateReport } from "@/components/practice/CandidateReport";
import { deserializeStoredCoachingReport } from "@/lib/ai";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function PracticeReportPage({ params }: PageProps) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      sessions: {
        where: {
          status: "COMPLETED",
          report: {
            isNot: null
          }
        },
        include: {
          report: true
        },
        orderBy: [{ endedAt: "desc" }, { startedAt: "desc" }],
        take: 1
      }
    }
  });

  if (!task) {
    notFound();
  }

  const latestReport = task.sessions[0]?.report;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link className="text-sm font-medium text-brand" href={`/practice/${task.id}` as Route}>
        Practice entry
      </Link>
      <div className="mt-4">
        {latestReport ? (
          <CandidateReport
            taskTitle={task.title}
            candidateName={task.candidate.name}
            targetCompany={task.targetCompany}
            targetRole={task.targetRole}
            report={deserializeStoredCoachingReport(latestReport)}
          />
        ) : (
          <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
            <h1 className="text-xl font-semibold text-ink">Report not ready</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Complete a practice session for this task to generate the candidate report.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

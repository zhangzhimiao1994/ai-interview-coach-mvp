import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { buildStagePlan, type StageConfigInput } from "@/lib/domain/stages";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function TrainingTaskDetailPage({ params }: PageProps) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      companyTemplate: true,
      jobTemplate: true,
      interviewerTemplate: true,
      sessions: {
        include: { report: true },
        orderBy: { startedAt: "desc" }
      }
    }
  });

  if (!task) {
    notFound();
  }

  const practiceUrl = `/practice/${task.id}`;
  const stagePlan = getStagePlan(task.stageConfig);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link className="text-sm font-medium text-brand" href={"/admin" as Route}>
        Back to admin
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-6">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-brand">Training task</p>
                <h1 className="mt-2 text-2xl font-semibold text-ink">{task.title}</h1>
                <p className="mt-2 text-muted">
                  {task.candidate.name} / {task.targetCompany} / {task.targetRole}
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">{task.status}</span>
            </div>

            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <InfoItem label="Expected duration" value={`${task.expectedMinutes} minutes`} />
              <InfoItem label="Interviewer" value={task.interviewerTemplate?.name || "Default interviewer"} />
              <InfoItem label="Company template" value={task.companyTemplate?.name || "None"} />
              <InfoItem label="Job template" value={task.jobTemplate?.title || "None"} />
            </dl>
          </Card>

          <Card>
            <h2 className="font-semibold text-ink">Practice link</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Share this link with the candidate to start a practice session.
            </p>
            <Link
              className="mt-3 block break-all rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-brand transition hover:bg-blue-50"
              href={practiceUrl as Route}
            >
              {practiceUrl}
            </Link>
          </Card>

          <Card>
            <h2 className="font-semibold text-ink">Stage plan</h2>
            <div className="mt-4 grid gap-3">
              {stagePlan.map((stage) => (
                <div key={stage.type} className="rounded-md border border-line bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-ink">{stage.label}</h3>
                    <span className="text-xs text-muted">{stage.durationMinutes} min</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{stage.description}</p>
                </div>
              ))}
              {stagePlan.length === 0 ? <p className="text-sm text-muted">No enabled stages.</p> : null}
            </div>
          </Card>
        </div>

        <Card className="h-fit">
          <h2 className="font-semibold text-ink">Session list</h2>
          <div className="mt-3 grid gap-3">
            {task.sessions.map((session) => {
              return (
                <div key={session.id} className="rounded-md border border-line bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink">{session.status}</span>
                    <span className="text-xs text-muted">{session.report ? "Report ready" : "No report"}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">{session.startedAt.toLocaleString("zh-CN")}</p>
                  {session.report ? (
                    <Link
                      className="mt-2 block break-all text-xs font-medium text-brand transition hover:text-ink"
                      href={`/admin/reports/${session.id}` as Route}
                    >
                      View backend report
                    </Link>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-muted">Report not generated yet</p>
                  )}
                </div>
              );
            })}
            {task.sessions.length === 0 ? (
              <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">
                No practice sessions yet.
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}

function getStagePlan(stageConfig: string) {
  try {
    return buildStagePlan(JSON.parse(stageConfig) as StageConfigInput[]);
  } catch {
    return [];
  }
}

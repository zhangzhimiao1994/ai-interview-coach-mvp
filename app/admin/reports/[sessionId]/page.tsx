import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReportView } from "@/components/admin/ReportView";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function AdminReportPage({ params }: PageProps) {
  const { sessionId } = await params;
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      candidate: true,
      task: true,
      turns: {
        orderBy: { createdAt: "asc" }
      },
      report: true
    }
  });

  if (!session) {
    notFound();
  }

  return (
    <AdminShell
      active="tasks"
      eyebrow="报告复盘"
      title={`${session.candidate.name} 的训练报告`}
      description={`${session.task.targetCompany} / ${session.task.targetRole}`}
      backHref={"/admin"}
    >
      <Link className="text-sm font-medium text-brand" href={`/admin/tasks/${session.task.id}` as Route}>
        Back to task
      </Link>
      <div className="mt-4">
        <ReportView session={session} />
      </div>
    </AdminShell>
  );
}

import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";
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
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link className="text-sm font-medium text-brand" href={`/admin/tasks/${session.task.id}` as Route}>
        Back to task
      </Link>
      <div className="mt-4">
        <ReportView session={session} />
      </div>
    </main>
  );
}

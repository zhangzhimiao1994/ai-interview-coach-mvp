import type { Route } from "next";
import Link from "next/link";
import { TrainingTaskForm } from "@/components/admin/TrainingTaskForm";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function NewTrainingTaskPage() {
  const [candidates, companies, jobs, interviewers] = await Promise.all([
    prisma.candidate.findMany({
      select: { id: true, name: true, targetCompany: true, targetRole: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.companyTemplate.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    prisma.jobTemplate.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
    prisma.interviewerTemplate.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "desc" } })
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">Training setup</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Create training task</h1>
        </div>
        <Link className="text-sm font-medium text-brand" href={"/admin" as Route}>
          Back to admin
        </Link>
      </div>
      <Card className="mt-6">
        <TrainingTaskForm candidates={candidates} companies={companies} jobs={jobs} interviewers={interviewers} />
      </Card>
    </main>
  );
}

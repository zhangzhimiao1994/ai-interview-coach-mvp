import type { Route } from "next";
import Link from "next/link";
import { TemplateManager } from "@/components/admin/TemplateManager";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [companies, jobs, interviewers] = await Promise.all([
    prisma.companyTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.jobTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.interviewerTemplate.findMany({ orderBy: { createdAt: "desc" } })
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">Template library</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Reusable interview assets</h1>
        </div>
        <Link className="text-sm font-medium text-brand" href={"/admin" as Route}>
          Back to admin
        </Link>
      </div>
      <div className="mt-6">
        <TemplateManager companies={companies} jobs={jobs} interviewers={interviewers} />
      </div>
    </main>
  );
}

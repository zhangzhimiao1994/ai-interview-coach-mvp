import type { Route } from "next";
import Link from "next/link";
import { CandidateForm } from "@/components/admin/CandidateForm";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const candidates = await prisma.candidate.findMany({
    include: {
      _count: {
        select: { tasks: true, sessions: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
      <Card className="h-fit">
        <h1 className="text-xl font-semibold text-ink">创建求职者</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          添加用于配置训练任务的服务档案。
        </p>
        <div className="mt-5">
          <CandidateForm />
        </div>
      </Card>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">求职者列表</h2>
            <p className="mt-1 text-sm text-muted">{candidates.length} 个档案</p>
          </div>
          <Link className="text-sm font-medium text-brand" href={"/admin" as Route}>
            返回后台
          </Link>
        </div>

        <div className="mt-4 grid gap-3">
          {candidates.map((candidate) => (
            <Card key={candidate.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-ink">{candidate.name}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {candidate.targetCompany || "未填写目标公司"} / {candidate.targetRole || "未填写目标岗位"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {candidate.email || candidate.phone || "未填写联系方式"}
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
                  {candidate.serviceStatus}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
                <span className="rounded-md bg-slate-50 px-2 py-1">{candidate._count.tasks} 个任务</span>
                <span className="rounded-md bg-slate-50 px-2 py-1">{candidate._count.sessions} 次训练</span>
              </div>
            </Card>
          ))}
          {candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">
              暂无求职者，请先从左侧表单创建第一个档案。
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

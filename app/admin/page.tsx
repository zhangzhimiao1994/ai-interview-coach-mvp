import type { Route } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const adminLinks = [
  {
    href: "/admin/candidates",
    title: "求职者档案",
    description: "创建和查看求职者资料，再为其分配面试训练任务。"
  },
  {
    href: "/admin/templates",
    title: "模板库",
    description: "查看训练任务使用的公司、岗位和面试官模板。"
  },
  {
    href: "/admin/tasks/new",
    title: "创建训练任务",
    description: "配置训练阶段、模板、面试官风格和求职者练习链接。"
  }
] as const;

export default async function AdminPage() {
  const [candidateCount, taskCount, sessionCount, recentTasks] = await Promise.all([
    prisma.candidate.count(),
    prisma.trainingTask.count(),
    prisma.trainingSession.count(),
    prisma.trainingTask.findMany({
      include: { candidate: true },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand">服务后台</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">服务后台</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            在一个工作区管理求职者档案、可复用模板和面试训练任务。
          </p>
        </div>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Metric label="求职者" value={candidateCount} />
        <Metric label="训练任务" value={taskCount} />
        <Metric label="训练会话" value={sessionCount} />
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {adminLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="h-full transition hover:border-brand">
              <h2 className="text-lg font-medium text-ink">{link.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{link.description}</p>
            </Card>
          </Link>
        ))}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">最近任务</h2>
          <Link className="text-sm font-medium text-brand" href={"/admin/tasks/new" as Route}>
            创建任务
          </Link>
        </div>
        <div className="mt-3 grid gap-3">
          {recentTasks.map((task) => (
            <Link key={task.id} href={`/admin/tasks/${task.id}` as Route}>
              <Card className="transition hover:border-brand">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-ink">{task.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {task.candidate.name} / {task.targetCompany} / {task.targetRole}
                    </p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">{task.status}</span>
                </div>
              </Card>
            </Link>
          ))}
          {recentTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">
              暂无训练任务。
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
    </Card>
  );
}

import type { Route } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const adminSections = [
  {
    group: "服务交付",
    href: "/admin/candidates",
    title: "求职者档案",
    description: "创建候选人、维护联系方式和目标公司岗位，跟进服务状态。"
  },
  {
    group: "知识库",
    href: "/admin/templates",
    title: "模板库",
    description: "沉淀公司情报、岗位能力、面试官类型和专业题库。"
  },
  {
    group: "服务交付",
    href: "/admin/tasks/new",
    title: "创建训练任务",
    description: "绑定候选人、目标公司、岗位模板、阶段开关和数字人面试官。"
  },
  {
    group: "AI能力",
    href: "/admin/ai-services",
    title: "AI 配置中心",
    description: "配置模型、服务商、API Key、能力路由、TTS、数字人和行为分析接口。"
  },
  {
    group: "数字人",
    href: "/admin/ai-services#digital-human",
    title: "数字人面试官",
    description: "管理数字人语音、形象、表情状态、朗读策略和视频渲染接口。"
  },
  {
    group: "行为分析",
    href: "/admin/ai-services#behavior-analysis",
    title: "行为信号分析",
    description: "查看摄像头/麦克风采集能力，配置视线、停顿、音量、语速等评分接口。"
  }
] as const;

export default async function AdminPage() {
  const [candidateCount, taskCount, sessionCount, providerCount, recentTasks] = await Promise.all([
    prisma.candidate.count(),
    prisma.trainingTask.count(),
    prisma.trainingSession.count(),
    prisma.aiServiceProvider.count(),
    prisma.trainingTask.findMany({
      include: { candidate: true },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return (
    <AdminShell
      active="overview"
      eyebrow="服务后台"
      title="运营控制台"
      description="集中管理候选人服务交付、专业知识库、AI 能力路由、数字人面试官和行为分析接口。"
    >
      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <Metric label="求职者" value={candidateCount} />
        <Metric label="训练任务" value={taskCount} />
        <Metric label="训练会话" value={sessionCount} />
        <Metric label="AI 服务商" value={providerCount} />
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {adminSections.map((link) => (
          <Link key={link.href} href={link.href as Route}>
            <Card className="h-full transition hover:border-brand">
              <p className="text-xs font-medium text-brand">{link.group}</p>
              <h2 className="mt-1 text-lg font-medium text-ink">{link.title}</h2>
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
    </AdminShell>
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

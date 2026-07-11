import { AdminShell } from "@/components/admin/AdminShell";
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
    <AdminShell
      active="tasks"
      eyebrow="服务交付"
      title="创建训练任务"
      description="绑定候选人、目标公司、岗位模板、面试官风格和训练阶段，生成候选人练习入口。"
      backHref={"/admin"}
    >
      <Card>
        <TrainingTaskForm candidates={candidates} companies={companies} jobs={jobs} interviewers={interviewers} />
      </Card>
    </AdminShell>
  );
}

import { AdminShell } from "@/components/admin/AdminShell";
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
    <AdminShell
      active="templates"
      eyebrow="知识库"
      title="模板库"
      description="管理公司模板、岗位能力模板和面试官模板，为专业化面试大纲提供上下文。"
      backHref={"/admin"}
    >
      <TemplateManager companies={companies} jobs={jobs} interviewers={interviewers} />
    </AdminShell>
  );
}

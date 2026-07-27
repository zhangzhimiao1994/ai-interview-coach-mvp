import { AdminShell } from "@/components/admin/AdminShell";
import { RecruitmentJobLibraryPanel } from "@/components/admin/recruitment/RecruitmentJobLibraryPanel";
import { RecruitmentSourcePanel } from "@/components/admin/recruitment/RecruitmentSourcePanel";
import { RecruitmentSyncRunPanel } from "@/components/admin/recruitment/RecruitmentSyncRunPanel";
import { RecruitmentTemplatePanel } from "@/components/admin/recruitment/RecruitmentTemplatePanel";
import { prisma } from "@/lib/db/prisma";
import { parseRecruitmentSyncLogs } from "@/lib/recruitment/sync";

export const dynamic = "force-dynamic";

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export default async function RecruitmentAdminPage() {
  const [sources, templates, postings, runs] = await Promise.all([
    prisma.recruitmentSource.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.recruitmentSearchTemplate.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.recruitmentJobPosting.findMany({
      where: { status: "ACTIVE" },
      orderBy: { lastSeenAt: "desc" },
      take: 50
    }),
    prisma.recruitmentSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 })
  ]);

  const sourceViews = sources.map((source) => ({
    id: source.id,
    provider: source.provider,
    sourceType: source.sourceType,
    displayName: source.displayName,
    enabled: source.enabled,
    credentialPreview: source.credentialPreview,
    sessionPreview: source.sessionPreview,
    verificationStatus: source.verificationStatus
  }));
  const templateViews = templates.map((template) => ({
    id: template.id,
    name: template.name,
    keywords: template.keywords,
    city: template.city,
    country: template.country,
    sourceIds: parseStringArray(template.sourceIdsJson),
    enabled: template.enabled
  }));

  return (
    <AdminShell
      active="recruitment"
      eyebrow="招聘数据"
      title="招聘数据采集"
      description="管理招聘来源、采集模板、岗位库和同步记录。登录态来源只保存授权记录，不保存招聘网站账号密码。"
      backHref="/admin"
    >
      <div className="grid gap-5">
        <RecruitmentSourcePanel sources={sourceViews} />
        <RecruitmentTemplatePanel templates={templateViews} sources={sourceViews} />
        <RecruitmentJobLibraryPanel postings={postings.map((posting) => ({
          id: posting.id,
          title: posting.title,
          company: posting.company,
          location: posting.location,
          provider: posting.provider,
          sourceUrl: posting.sourceUrl,
          status: posting.status,
          updatedAt: posting.updatedAt
        }))} />
        <RecruitmentSyncRunPanel
          runs={runs.map((run) => ({
            id: run.id,
            templateId: run.templateId,
            sourceId: run.sourceId,
            mode: run.mode,
            status: run.status,
            insertedCount: run.insertedCount,
            updatedCount: run.updatedCount,
            skippedCount: run.skippedCount,
            failureReason: run.failureReason,
            startedAt: run.startedAt,
            logs: parseRecruitmentSyncLogs(run.logsJson)
          }))}
          templates={templateViews}
          sources={sourceViews}
        />
      </div>
    </AdminShell>
  );
}

import React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import type { RecruitmentSourceView, RecruitmentSyncRunView, RecruitmentTemplateView } from "@/components/admin/recruitment/types";

export function RecruitmentSyncRunPanel({
  runs,
  templates,
  sources
}: {
  runs: RecruitmentSyncRunView[];
  templates: RecruitmentTemplateView[];
  sources: RecruitmentSourceView[];
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand">Sync runs</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">采集任务</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            手动触发采集并查看脱敏后的状态、错误分类、插入和更新数量。
          </p>
        </div>
        <Button type="button">Run sync</Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SelectField label="Template" name="templateId">
          <option value="">Select template</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </SelectField>
        <SelectField label="Source" name="sourceId">
          <option value="">All enabled sources</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>{source.displayName}</option>
          ))}
        </SelectField>
      </div>

      <div className="mt-5 grid gap-3">
        {runs.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-white p-4 text-sm text-muted">暂无采集记录。</p>
        ) : runs.map((run) => (
          <div key={run.id} className="rounded-md border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium text-ink">{run.status}</h3>
              <span className="text-xs text-muted">{run.mode}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              inserted {run.insertedCount}, updated {run.updatedCount}, skipped {run.skippedCount}
              {run.failureReason ? ` / ${run.failureReason}` : ""}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

import React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { RecruitmentSourceView, RecruitmentTemplateView } from "@/components/admin/recruitment/types";

export function RecruitmentTemplatePanel({
  templates,
  sources
}: {
  templates: RecruitmentTemplateView[];
  sources: RecruitmentSourceView[];
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand">Search templates</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">采集模板</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            用关键词、城市、国家、远程方式和来源组合定义采集范围，可绑定到候选人。
          </p>
        </div>
        <Button type="button">Save template</Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Field label="Template name" name="name" placeholder="Frontend global" />
        <Field label="Keywords" name="keywords" placeholder="React TypeScript" />
        <Field label="City" name="city" placeholder="Remote" />
        <Field label="Country" name="country" placeholder="US" />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {sources.length === 0 ? (
          <span className="text-sm text-muted">No sources available</span>
        ) : sources.map((source) => (
          <label key={source.id} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
            <input type="checkbox" name="sourceIds" value={source.id} />
            {source.displayName}
          </label>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        {templates.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-white p-4 text-sm text-muted">暂无采集模板。</p>
        ) : templates.map((template) => (
          <div key={template.id} className="rounded-md border border-line bg-white p-4">
            <h3 className="font-medium text-ink">{template.name}</h3>
            <p className="mt-1 text-sm text-muted">
              {template.keywords} / {template.city || "Any city"} / {template.country || "Any country"}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

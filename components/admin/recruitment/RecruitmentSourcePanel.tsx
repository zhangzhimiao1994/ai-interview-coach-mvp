import React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import type { RecruitmentSourceView } from "@/components/admin/recruitment/types";

export function RecruitmentSourcePanel({ sources }: { sources: RecruitmentSourceView[] }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand">Recruitment sources</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">招聘来源</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            支持聚合 API、公开 ATS 和已授权浏览器来源。凭证只展示预览，不在前端暴露密文。
          </p>
        </div>
        <Button type="button">Add source</Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <SelectField label="Provider" name="provider" defaultValue="adzuna">
          <option value="adzuna">Adzuna</option>
          <option value="jooble">Jooble</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
          <option value="usajobs">USAJOBS</option>
          <option value="custom">Custom provider</option>
        </SelectField>
        <SelectField label="Source type" name="sourceType" defaultValue="AGGREGATED_API">
          <option value="AGGREGATED_API">Aggregated API</option>
          <option value="PUBLIC_SOURCE">Public source</option>
          <option value="AUTHORIZED_BROWSER">Authorized browser</option>
        </SelectField>
        <Field label="Display name" name="displayName" placeholder="Adzuna US" />
        <Field label="Custom settings JSON" name="settingsJson" placeholder='{"country":"us"}' />
      </div>

      <div className="mt-5 grid gap-3">
        {sources.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-white p-4 text-sm text-muted">
            暂无招聘来源。先配置 API 来源或公开 ATS 来源，再创建采集模板。
          </p>
        ) : sources.map((source) => (
          <div key={source.id} className="rounded-md border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium text-ink">{source.displayName}</h3>
                <p className="mt-1 text-sm text-muted">
                  {source.provider} / {source.sourceType} / {source.verificationStatus}
                </p>
              </div>
              <span className={source.enabled ? "text-sm text-emerald-700" : "text-sm text-muted"}>
                {source.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">
              Credential: {source.credentialPreview || "not set"} / Session: {source.sessionPreview || "not set"}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

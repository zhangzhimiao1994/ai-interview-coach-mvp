import React from "react";
import type { Route } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { RecruitmentPostingView } from "@/components/admin/recruitment/types";

export function RecruitmentJobLibraryPanel({ postings }: { postings: RecruitmentPostingView[] }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand">Job library</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">岗位库</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            自动采集和手动导入的岗位会进入这里；创建训练任务时会复制快照，避免原岗位变化影响已创建任务。
          </p>
        </div>
        <Button type="button">Manual import</Button>
      </div>

      <div className="mt-5 grid gap-3">
        {postings.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-white p-4 text-sm text-muted">
            暂无岗位。可以先手动导入，也可以从同步任务采集。
          </p>
        ) : postings.map((posting) => (
          <div key={posting.id} className="rounded-md border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-ink">{posting.title}</h3>
                <p className="mt-1 text-sm text-muted">
                  {posting.company || "Unknown company"} / {posting.location || "Unknown location"} / {posting.provider}
                </p>
              </div>
              <Link className="text-sm font-medium text-brand" href={"/admin/tasks/new" as Route}>
                Create training task
              </Link>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

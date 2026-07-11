import React from "react";
import type { CoachingReportResult } from "@/lib/ai";

type CandidateReportProps = {
  taskTitle: string;
  candidateName: string;
  targetCompany: string;
  targetRole: string;
  report: CoachingReportResult;
};

export function CandidateReport({
  taskTitle,
  candidateName,
  targetCompany,
  targetRole,
  report
}: CandidateReportProps) {
  const details = report.details;

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <p className="text-sm font-medium text-brand">候选人报告</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{taskTitle}</h1>
        <p className="mt-2 text-sm text-muted">
          {candidateName} / {targetCompany} / {targetRole}
        </p>
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm text-muted">综合评分</p>
            <p className="mt-1 text-4xl font-semibold text-ink">{report.overallScore}</p>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted">{report.candidateSummary}</p>
        </div>
      </section>

      {details ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <ReportPanel title="面试结论">
            <p className="text-sm font-medium text-ink">{details.readinessVerdict.summary}</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              主要风险：{details.readinessVerdict.priorityRisk}
            </p>
            <ScoreExplanationList explanations={details.scoreExplanations} />
          </ReportPanel>

          <ReportPanel title="优先改进项">
            <div className="grid gap-3">
              {details.priorityActions.map((action) => (
                <div key={action.title} className="rounded-md border border-line bg-white p-3">
                  <h3 className="text-sm font-semibold text-ink">{action.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{action.reason}</p>
                  <p className="mt-2 text-xs leading-5 text-muted">训练：{action.drill}</p>
                </div>
              ))}
            </div>
          </ReportPanel>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <ReportPanel title="表达表现">
          <p className="text-sm leading-6 text-muted">{report.expressionAnalysis.summary}</p>
          <TagList items={report.expressionAnalysis.strongPoints} />
        </ReportPanel>
        <ReportPanel title="回答质量">
          <p className="text-sm leading-6 text-muted">{report.answerQualityAnalysis.summary}</p>
          <TagList items={report.answerQualityAnalysis.evidence} />
        </ReportPanel>
      </section>

      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h2 className="font-semibold text-ink">逐题反馈</h2>
        <div className="mt-4 grid gap-3">
          {report.perQuestionFeedback.map((feedback) => (
            <div key={feedback.questionId} className="rounded-md border border-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-ink">{stageLabel(feedback.stage)}</h3>
                <span className="text-sm font-semibold text-brand">{feedback.score}</span>
              </div>
              <p className="mt-2 text-sm text-muted">亮点：{feedback.strengths.join("、")}</p>
              <p className="mt-1 text-sm text-muted">改进：{feedback.improvements.join("、")}</p>
              {feedback.answerEvidence?.length ? (
                <p className="mt-1 text-sm text-muted">回答证据：{feedback.answerEvidence.join("、")}</p>
              ) : null}
              {feedback.improvementAction ? (
                <p className="mt-1 text-sm text-muted">下一步动作：{feedback.improvementAction}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {details ? (
        <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <h2 className="font-semibold text-ink">七天训练计划</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {details.weeklyPlan.map((item) => (
              <div key={`${item.day}-${item.stage}`} className="rounded-md border border-line bg-white p-3">
                <p className="text-xs font-medium text-muted">第 {item.day} 天 / {stageLabel(item.stage)}</p>
                <p className="mt-2 text-sm font-medium text-ink">{item.drill}</p>
                <p className="mt-1 text-xs leading-5 text-muted">达标标准：{item.successCriterion}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <ReportPanel title="策略建议">
          <TagList items={report.strategySuggestions} />
        </ReportPanel>
        <ReportPanel title="下一轮训练">
          <p className="text-sm leading-6 text-muted">{report.nextTrainingPlan.focus}</p>
          <TagList items={report.nextTrainingPlan.drills} />
        </ReportPanel>
      </section>
    </div>
  );
}

const scoreExplanationLabels: Record<string, string> = {
  expressionStructure: "表达结构",
  contentRelevance: "内容相关度",
  confidence: "自信度",
  pressureHandling: "压力应对",
  roleFit: "岗位匹配"
};

function ScoreExplanationList({ explanations }: { explanations: Record<string, string> }) {
  const entries = Object.entries(explanations);

  if (entries.length === 0) {
    return null;
  }

  return (
    <dl className="mt-4 grid gap-2 text-sm">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="font-medium text-ink">{scoreExplanationLabels[key] ?? key}</dt>
          <dd className="mt-1 leading-6 text-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    WARM_UP: "热身开场",
    FORMAL_INTERVIEW: "正式面试",
    PRESSURE_FOLLOW_UP: "压力追问",
    EXPERIENCE_DEEP_DIVE: "经历深挖",
    CASE_ANALYSIS: "案例分析",
    ENGLISH_INTERVIEW: "英文面试",
    AI_REVIEW: "AI 复盘",
    FOLLOW_UP_PLAN: "后续计划"
  };

  return labels[stage] ?? stage;
}

function ReportPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
      <h2 className="font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
          {item}
        </li>
      ))}
    </ul>
  );
}

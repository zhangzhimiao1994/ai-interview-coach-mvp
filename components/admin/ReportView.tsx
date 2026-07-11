import React from "react";
import { safeDeserializeStoredCoachingReport, type CoachingReportResult, type StoredCoachingReportRecord } from "@/lib/ai";

type StoredReport = StoredCoachingReportRecord & {
  id: string;
  sessionId: string;
  createdAt: Date;
};

export type ReportViewSession = {
  id: string;
  status: string;
  currentStage: string | null;
  startedAt: Date;
  endedAt: Date | null;
  candidate: {
    id: string;
    name: string;
    targetCompany: string | null;
    targetRole: string | null;
  };
  task: {
    id: string;
    title: string;
    targetCompany: string;
    targetRole: string;
  };
  turns: Array<{
    id: string;
    stage: string;
    question: string;
    answer: string;
    behaviorSignalsJson?: string | null;
    feedback: string | null;
    createdAt: Date;
  }>;
  report: StoredReport | null;
};

type ReportViewProps = {
  session: ReportViewSession;
};

const subScoreLabels = {
  expressionStructure: "Expression structure",
  contentRelevance: "Content relevance",
  confidence: "Confidence",
  pressureHandling: "Pressure handling",
  roleFit: "Role fit"
} as const;

export function ReportView({ session }: ReportViewProps) {
  if (!session.report) {
    return (
      <div className="grid gap-6">
        <ReportHeader session={session} />
        <Panel>
          <p className="text-sm font-medium text-brand">Report not generated yet</p>
          <h1 className="mt-2 text-xl font-semibold text-ink">This session has no backend coaching report yet.</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Complete the practice session and generate a coaching report before opening the full admin review.
          </p>
        </Panel>
        <TranscriptSection turns={session.turns} />
      </div>
    );
  }

  const reportResult = safeDeserializeStoredCoachingReport(session.report);

  if (!reportResult.ok) {
    return (
      <div className="grid gap-6">
        <ReportHeader session={session} />
        <InvalidReportPanel error={reportResult.error} />
        <TranscriptSection turns={session.turns} />
      </div>
    );
  }

  const report = reportResult.report;
  const details = report.details;

  return (
    <div className="grid gap-6">
      <ReportHeader session={session} />

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand">Backend coaching report</p>
            <p className="mt-2 text-5xl font-semibold text-ink">{report.overallScore}</p>
            <p className="mt-1 text-sm text-muted">Overall score</p>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-muted">{report.candidateSummary}</p>
        </div>
      </Panel>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(report.subScores).map(([key, value]) => (
          <Panel key={key} className="p-4">
            <p className="text-xs font-medium uppercase text-muted">
              {subScoreLabels[key as keyof typeof subScoreLabels]}
            </p>
            <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
          </Panel>
        ))}
      </section>

      {details ? (
        <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
          <ReportPanel title="录用风险评估">
            <p className="text-sm font-medium text-ink">{details.readinessVerdict.summary}</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              优先风险：{details.readinessVerdict.priorityRisk}
            </p>
            <p className="mt-2 text-xs font-medium text-brand">{details.readinessVerdict.level}</p>
          </ReportPanel>

          <ReportPanel title="胜任力矩阵">
            <div className="grid gap-3">
              {details.competencyAssessment.map((item) => (
                <div key={item.competency} className="rounded-md border border-line bg-white p-3">
                  <h3 className="text-sm font-semibold text-ink">{item.competency}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">证据：{item.evidence}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">风险：{item.risk}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">动作：{item.coachingAction}</p>
                </div>
              ))}
            </div>
          </ReportPanel>

          <ReportPanel title="服务跟进建议">
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

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportPanel title="Expression analysis">
          <p className="text-sm leading-6 text-muted">{report.expressionAnalysis.summary}</p>
          <ListBlock title="Strong points" items={report.expressionAnalysis.strongPoints} />
          <ListBlock title="Improve" items={report.expressionAnalysis.improvementPoints} />
        </ReportPanel>

        <ReportPanel title="Answer quality">
          <p className="text-sm leading-6 text-muted">{report.answerQualityAnalysis.summary}</p>
          <ListBlock title="Evidence" items={report.answerQualityAnalysis.evidence} />
          <ListBlock title="Gaps" items={report.answerQualityAnalysis.gaps} />
        </ReportPanel>
      </section>

      {details?.behaviorEvidence?.length ? (
        <ReportPanel title="行为信号证据">
          <p className="text-sm leading-6 text-muted">
            这里只呈现可观察信号，例如回答时长、长停顿、摄像头/麦克风状态和音量波动，不输出心理诊断。
          </p>
          <BehaviorEvidenceList evidence={details.behaviorEvidence} />
        </ReportPanel>
      ) : null}

      <Panel>
        <h2 className="font-semibold text-ink">Per-question feedback</h2>
        <div className="mt-4 grid gap-3">
          {report.perQuestionFeedback.length > 0 ? (
            report.perQuestionFeedback.map((feedback, index) => {
              const turn = session.turns[index];

              return (
                <div key={feedback.questionId} className="rounded-md border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase text-muted">{feedback.stage}</p>
                      <h3 className="mt-1 text-sm font-semibold text-ink">
                        {turn?.question || feedback.questionId}
                      </h3>
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-brand">
                      {feedback.score}
                    </span>
                  </div>
                  <ListBlock title="Strengths" items={feedback.strengths} />
                  <ListBlock title="Improvements" items={feedback.improvements} />
                  <ListBlock title="Answer evidence" items={feedback.answerEvidence ?? []} />
                  {feedback.improvementAction ? (
                    <p className="mt-3 text-sm leading-6 text-muted">
                      Next action: {feedback.improvementAction}
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">
              No per-question feedback was generated for this report.
            </p>
          )}
        </div>
      </Panel>

      <section className="grid gap-4 lg:grid-cols-3">
        <ReportPanel title="Strategy suggestions">
          <TagList items={report.strategySuggestions} />
        </ReportPanel>

        <ReportPanel title="Weak tags">
          <TagList items={report.weakTags} />
        </ReportPanel>

        <ReportPanel title="Next training plan">
          <p className="text-sm leading-6 text-muted">{report.nextTrainingPlan.focus}</p>
          <ListBlock title="Drills" items={report.nextTrainingPlan.drills} />
          <ListBlock title="Recommended stages" items={report.nextTrainingPlan.recommendedStages} />
        </ReportPanel>
      </section>

      {details ? (
        <ReportPanel title="七天训练计划">
          <div className="grid gap-3 md:grid-cols-2">
            {details.weeklyPlan.map((item) => (
              <div key={`${item.day}-${item.stage}`} className="rounded-md border border-line bg-white p-3">
                <p className="text-xs font-medium uppercase text-muted">
                  Day {item.day} / {item.stage}
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{item.drill}</p>
                <p className="mt-1 text-xs leading-5 text-muted">Success: {item.successCriterion}</p>
              </div>
            ))}
          </div>
        </ReportPanel>
      ) : null}

      <TranscriptSection turns={session.turns} />
    </div>
  );
}

function InvalidReportPanel({ error }: { error: string }) {
  return (
    <Panel>
      <p className="text-sm font-medium text-brand">报告数据格式异常</p>
      <h2 className="mt-2 text-xl font-semibold text-ink">Invalid report data</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        The stored coaching report cannot be rendered because its data format is invalid.
      </p>
      <p className="mt-3 rounded-md border border-dashed border-line bg-white p-3 text-xs leading-5 text-muted">
        {error}
      </p>
    </Panel>
  );
}

function ReportHeader({ session }: { session: ReportViewSession }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand">Admin report view</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">{session.task.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {session.candidate.name} / {session.task.targetCompany} / {session.task.targetRole}
          </p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-muted">
          {session.status}
        </span>
      </div>

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <InfoItem label="Candidate" value={session.candidate.name} />
        <InfoItem label="Company" value={session.task.targetCompany} />
        <InfoItem label="Role" value={session.task.targetRole} />
        <InfoItem label="Turns" value={String(session.turns.length)} />
        <InfoItem label="Current stage" value={session.currentStage || "None"} />
        <InfoItem label="Started" value={formatDate(session.startedAt)} />
        <InfoItem label="Ended" value={session.endedAt ? formatDate(session.endedAt) : "Not ended"} />
        <InfoItem label="Report created" value={session.report ? formatDate(session.report.createdAt) : "None"} />
      </dl>
    </Panel>
  );
}

function TranscriptSection({ turns }: { turns: ReportViewSession["turns"] }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-ink">Turns and transcript summary</h2>
        <span className="text-xs text-muted">{turns.length} turns</span>
      </div>
      <div className="mt-4 grid gap-3">
        {turns.map((turn, index) => (
          <div key={turn.id} className="rounded-md border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase text-muted">
                {index + 1}. {turn.stage}
              </p>
              <p className="text-xs text-muted">{formatDate(turn.createdAt)}</p>
            </div>
            <p className="mt-3 text-sm font-medium text-ink">{turn.question}</p>
            <p className="mt-2 text-sm leading-6 text-muted">{turn.answer}</p>
            {turn.behaviorSignalsJson ? (
              <p className="mt-2 text-xs leading-5 text-muted">Behavior signals: {turn.behaviorSignalsJson}</p>
            ) : null}
            {turn.feedback ? <p className="mt-2 text-xs leading-5 text-muted">Feedback: {turn.feedback}</p> : null}
          </div>
        ))}
        {turns.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">
            No transcript turns recorded.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function ReportPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <h2 className="font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </Panel>
  );
}

function Panel({
  className = "",
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-line bg-panel p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase text-muted">{title}</p>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">None</p>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
          {item}
        </li>
      ))}
    </ul>
  );
}

function BehaviorEvidenceList({
  evidence
}: {
  evidence: NonNullable<NonNullable<CoachingReportResult["details"]>["behaviorEvidence"]>;
}) {
  return (
    <div className="mt-4 grid gap-3">
      {evidence.map((item, index) => (
        <div key={`${item.questionId ?? "behavior"}-${index}`} className="rounded-md border border-line bg-white p-3">
          <p className="text-xs font-medium uppercase text-muted">{item.questionId ?? "overall"}</p>
          <ListBlock title="Observations" items={item.observations} />
          <ListBlock title="Interview risks" items={item.risks} />
          <ListBlock title="Coaching tips" items={item.coachingTips} />
        </div>
      ))}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}

function formatDate(date: Date) {
  return date.toLocaleString("zh-CN");
}

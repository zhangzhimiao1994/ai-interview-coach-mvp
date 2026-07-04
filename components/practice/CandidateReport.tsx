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
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <p className="text-sm font-medium text-brand">Candidate report</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{taskTitle}</h1>
        <p className="mt-2 text-sm text-muted">
          {candidateName} / {targetCompany} / {targetRole}
        </p>
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm text-muted">Overall score</p>
            <p className="mt-1 text-4xl font-semibold text-ink">{report.overallScore}</p>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted">{report.candidateSummary}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ReportPanel title="Expression">
          <p className="text-sm leading-6 text-muted">{report.expressionAnalysis.summary}</p>
          <TagList items={report.expressionAnalysis.strongPoints} />
        </ReportPanel>
        <ReportPanel title="Answer Quality">
          <p className="text-sm leading-6 text-muted">{report.answerQualityAnalysis.summary}</p>
          <TagList items={report.answerQualityAnalysis.evidence} />
        </ReportPanel>
      </section>

      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h2 className="font-semibold text-ink">Question feedback</h2>
        <div className="mt-4 grid gap-3">
          {report.perQuestionFeedback.map((feedback) => (
            <div key={feedback.questionId} className="rounded-md border border-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-ink">{feedback.stage}</h3>
                <span className="text-sm font-semibold text-brand">{feedback.score}</span>
              </div>
              <p className="mt-2 text-sm text-muted">Strengths: {feedback.strengths.join(", ")}</p>
              <p className="mt-1 text-sm text-muted">Improve: {feedback.improvements.join(", ")}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ReportPanel title="Strategy Suggestions">
          <TagList items={report.strategySuggestions} />
        </ReportPanel>
        <ReportPanel title="Next Training Plan">
          <p className="text-sm leading-6 text-muted">{report.nextTrainingPlan.focus}</p>
          <TagList items={report.nextTrainingPlan.drills} />
        </ReportPanel>
      </section>
    </div>
  );
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

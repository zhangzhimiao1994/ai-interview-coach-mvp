import { Card } from "@/components/ui/Card";

type TemplateManagerProps = {
  companies: Array<{
    id: string;
    name: string;
    industry: string | null;
    interviewStyle: string;
    competencyModel: string;
  }>;
  jobs: Array<{
    id: string;
    title: string;
    category: string;
    competencyModel: string;
    riskQuestions: string;
  }>;
  interviewers: Array<{
    id: string;
    name: string;
    tone: string;
    followUpDepth: number;
    interruptFrequency: number;
    challengeIntensity: number;
    languageMode: string;
  }>;
};

export function TemplateManager({ companies, jobs, interviewers }: TemplateManagerProps) {
  return (
    <div className="grid gap-8">
      <TemplateSection title="Company templates" emptyText="No company templates yet.">
        {companies.map((company) => (
          <Card key={company.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-ink">{company.name}</h3>
                <p className="mt-1 text-xs uppercase tracking-normal text-muted">
                  {company.industry || "General"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">{company.interviewStyle}</p>
            <p className="mt-3 text-sm leading-6 text-muted">{company.competencyModel}</p>
          </Card>
        ))}
      </TemplateSection>

      <TemplateSection title="Job templates" emptyText="No job templates yet.">
        {jobs.map((job) => (
          <Card key={job.id}>
            <h3 className="font-medium text-ink">{job.title}</h3>
            <p className="mt-1 text-xs uppercase tracking-normal text-muted">{job.category}</p>
            <p className="mt-3 text-sm leading-6 text-muted">{job.competencyModel}</p>
            <p className="mt-3 text-sm leading-6 text-muted">{job.riskQuestions}</p>
          </Card>
        ))}
      </TemplateSection>

      <TemplateSection title="Interviewer templates" emptyText="No interviewer templates yet.">
        {interviewers.map((interviewer) => (
          <Card key={interviewer.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-ink">{interviewer.name}</h3>
                <p className="mt-1 text-xs uppercase tracking-normal text-muted">
                  {interviewer.languageMode}
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
                Intensity {interviewer.challengeIntensity}/5
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">{interviewer.tone}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Follow-up depth</dt>
                <dd className="mt-1 font-medium text-ink">{interviewer.followUpDepth}</dd>
              </div>
              <div>
                <dt className="text-muted">Interruptions</dt>
                <dd className="mt-1 font-medium text-ink">{interviewer.interruptFrequency}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </TemplateSection>
    </div>
  );
}

function TemplateSection({
  title,
  emptyText,
  children
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasItems = Array.isArray(items) ? items.length > 0 : Boolean(items);

  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {hasItems ? <div className="mt-3 grid gap-3 md:grid-cols-2">{items}</div> : <EmptyState text={emptyText} />}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">
      {text}
    </div>
  );
}

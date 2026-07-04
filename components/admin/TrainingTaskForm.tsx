"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { defaultStageTemplates } from "@/lib/domain/stages";

type TrainingTaskFormProps = {
  candidates: Array<{
    id: string;
    name: string;
    targetCompany: string | null;
    targetRole: string | null;
  }>;
  companies: Array<{ id: string; name: string }>;
  jobs: Array<{ id: string; title: string }>;
  interviewers: Array<{ id: string; name: string }>;
};

type SaveState = "idle" | "saving" | "error";

export function TrainingTaskForm({ candidates, companies, jobs, interviewers }: TrainingTaskFormProps) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [candidateId, setCandidateId] = useState(candidates[0]?.id || "");
  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === candidateId),
    [candidateId, candidates]
  );
  const [targetCompany, setTargetCompany] = useState(candidates[0]?.targetCompany || "");
  const [targetRole, setTargetRole] = useState(candidates[0]?.targetRole || "");

  function selectCandidate(nextCandidateId: string) {
    const nextCandidate = candidates.find((candidate) => candidate.id === nextCandidateId);
    setCandidateId(nextCandidateId);
    setTargetCompany(nextCandidate?.targetCompany || "");
    setTargetRole(nextCandidate?.targetRole || "");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState("saving");
    setMessage("");

    try {
      const form = new FormData(formElement);
      const stageConfig = defaultStageTemplates.map((stage) => ({
        type: stage.type,
        enabled: form.get(`stage-${stage.type}`) === "on",
        durationMinutes: Number(form.get(`duration-${stage.type}`) || stage.durationMinutes),
        visibleTransition: form.get(`visible-${stage.type}`) === "on"
      }));

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: form.get("candidateId"),
          companyTemplateId: form.get("companyTemplateId") || undefined,
          jobTemplateId: form.get("jobTemplateId") || undefined,
          interviewerTemplateId: form.get("interviewerTemplateId") || undefined,
          title: form.get("title"),
          targetCompany: form.get("targetCompany"),
          targetRole: form.get("targetRole"),
          expectedMinutes: Number(form.get("expectedMinutes")),
          stageConfig
        })
      });

      const payload = (await response.json().catch(() => null)) as { task?: { id: string }; error?: string } | null;

      if (!response.ok || !payload?.task?.id) {
        setState("error");
        setMessage(payload?.error || "Could not create the training task.");
        return;
      }

      router.push(`/admin/tasks/${payload.task.id}` as Route);
    } catch {
      setState("error");
      setMessage("Could not reach the server. Please check your connection and try again.");
    } finally {
      setState((current) => (current === "saving" ? "idle" : current));
    }
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-white p-6">
        <h2 className="font-medium text-ink">Create a candidate first</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Training tasks need a candidate profile before they can be configured.
        </p>
        <Button className="mt-4" type="button" onClick={() => router.push("/admin/candidates" as Route)}>
          Add candidate
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Field
        label="Training title"
        name="title"
        required
        defaultValue={`${selectedCandidate?.name || "Candidate"} interview practice`}
      />
      <SelectField
        label="Candidate"
        name="candidateId"
        required
        value={candidateId}
        onChange={(event) => selectCandidate(event.target.value)}
      >
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Target company"
          name="targetCompany"
          required
          value={targetCompany}
          onChange={(event) => setTargetCompany(event.target.value)}
        />
        <Field
          label="Target role"
          name="targetRole"
          required
          value={targetRole}
          onChange={(event) => setTargetRole(event.target.value)}
        />
      </div>
      <Field
        label="Expected minutes"
        name="expectedMinutes"
        type="number"
        min={5}
        max={120}
        defaultValue={30}
        required
      />
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField label="Company template" name="companyTemplateId">
          <option value="">None</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Job template" name="jobTemplateId">
          <option value="">None</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </SelectField>
        <SelectField label="Interviewer" name="interviewerTemplateId">
          <option value="">Default</option>
          {interviewers.map((interviewer) => (
            <option key={interviewer.id} value={interviewer.id}>
              {interviewer.name}
            </option>
          ))}
        </SelectField>
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Training stages</h2>
            <p className="mt-1 text-sm text-muted">Enable the stages used for this practice session.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {defaultStageTemplates.map((stage) => (
            <div key={stage.type} className="rounded-lg border border-line bg-white p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_130px] md:items-start">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      className="h-4 w-4 rounded border-line text-brand"
                      name={`stage-${stage.type}`}
                      type="checkbox"
                      defaultChecked={stage.enabled}
                    />
                    {stage.label}
                  </label>
                  <p className="mt-2 text-sm leading-6 text-muted">{stage.description}</p>
                  <label className="mt-3 flex items-center gap-2 text-xs text-muted">
                    <input
                      className="h-4 w-4 rounded border-line text-brand"
                      name={`visible-${stage.type}`}
                      type="checkbox"
                      defaultChecked={stage.visibleTransition}
                    />
                    Show stage transition prompt
                  </label>
                </div>
                <Field
                  label="Minutes"
                  name={`duration-${stage.type}`}
                  type="number"
                  min={1}
                  defaultValue={stage.durationMinutes}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <Button disabled={state === "saving"} type="submit">
        {state === "saving" ? "Creating..." : "Create training task"}
      </Button>
    </form>
  );
}

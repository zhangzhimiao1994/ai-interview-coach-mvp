"use client";

import type { Route } from "next";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { TrainingOutline } from "@/lib/ai";
import type { StagePlanItem } from "@/lib/domain/stages";
import { StageTimeline } from "./StageTimeline";

type PracticeEntryProps = {
  task: {
    id: string;
    title: string;
    targetCompany: string;
    targetRole: string;
    expectedMinutes: number;
    candidateName: string;
    interviewerName: string;
  };
  stages: StagePlanItem[];
};

type SessionPayload = {
  session?: {
    id: string;
  };
  outline?: TrainingOutline;
  error?: string;
};

function storageKey(taskId: string) {
  return `practice:${taskId}:session`;
}

export function PracticeEntry({ task, stages }: PracticeEntryProps) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState("");

  async function startPractice() {
    setIsStarting(true);
    setMessage("");

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id })
      });
      const payload = (await response.json().catch(() => null)) as SessionPayload | null;

      if (!response.ok || !payload?.session?.id || !payload.outline) {
        setMessage(payload?.error || "Could not start this practice session.");
        return;
      }

      sessionStorage.setItem(
        storageKey(task.id),
        JSON.stringify({
          sessionId: payload.session.id,
          outline: payload.outline,
          startedAt: new Date().toISOString()
        })
      );
      router.push(`/practice/${task.id}/room` as Route);
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <p className="text-sm font-medium text-brand">Practice session</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{task.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {task.candidateName} will practice for {task.targetCompany} / {task.targetRole}.
        </p>

        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <InfoItem label="Expected duration" value={`${task.expectedMinutes} minutes`} />
          <InfoItem label="Interviewer" value={task.interviewerName} />
          <InfoItem label="Enabled stages" value={`${stages.length}`} />
          <InfoItem label="Question mode" value="Text transcript simulation" />
        </dl>

        {message ? <p className="mt-5 text-sm text-red-600">{message}</p> : null}
        <Button className="mt-6 gap-2" disabled={isStarting || stages.length === 0} onClick={startPractice}>
          <Play className="h-4 w-4" aria-hidden="true" />
          {isStarting ? "Starting..." : "Start practice"}
        </Button>
      </section>

      <aside className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h2 className="font-semibold text-ink">Stage timeline</h2>
        <div className="mt-4">
          <StageTimeline stages={stages} currentStage={stages[0]?.type} />
        </div>
      </aside>
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

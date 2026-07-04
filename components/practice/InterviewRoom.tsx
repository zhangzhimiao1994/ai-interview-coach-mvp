"use client";

import type { Route } from "next";
import Link from "next/link";
import { CheckCircle2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { TrainingOutline, TrainingQuestion } from "@/lib/ai";
import type { StagePlanItem } from "@/lib/domain/stages";
import { StageTimeline } from "./StageTimeline";

type InterviewRoomProps = {
  taskId: string;
  taskTitle: string;
  stages: StagePlanItem[];
};

type StoredSession = {
  sessionId: string;
  outline: TrainingOutline;
  startedAt: string;
  currentQuestionIndex?: number;
  completedQuestionIds?: string[];
};

type SaveState = "idle" | "saving" | "completing";

function storageKey(taskId: string) {
  return `practice:${taskId}:session`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStoredOutline(value: unknown): value is TrainingOutline {
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    return false;
  }

  return value.questions.every(
    (question) =>
      isRecord(question) &&
      typeof question.id === "string" &&
      typeof question.stage === "string" &&
      typeof question.prompt === "string" &&
      Array.isArray(question.followUps)
  );
}

function safeParseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      !isRecord(parsed) ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.trim().length === 0 ||
      !isStoredOutline(parsed.outline)
    ) {
      return null;
    }

    const questionIds = new Set(parsed.outline.questions.map((question) => question.id));
    const completedQuestionIds = Array.isArray(parsed.completedQuestionIds)
      ? parsed.completedQuestionIds.filter((id): id is string => typeof id === "string" && questionIds.has(id))
      : [];
    const currentQuestionIndex =
      typeof parsed.currentQuestionIndex === "number" && Number.isInteger(parsed.currentQuestionIndex)
        ? parsed.currentQuestionIndex
        : undefined;

    return {
      sessionId: parsed.sessionId.trim(),
      outline: parsed.outline,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      completedQuestionIds,
      currentQuestionIndex
    };
  } catch {
    return null;
  }
}

function initialQuestionIndex(session: StoredSession) {
  const questionCount = session.outline.questions.length;

  if (questionCount === 0) {
    return 0;
  }

  if (
    typeof session.currentQuestionIndex === "number" &&
    session.currentQuestionIndex >= 0 &&
    session.currentQuestionIndex < questionCount
  ) {
    return session.currentQuestionIndex;
  }

  return Math.min(session.completedQuestionIds?.length ?? 0, questionCount - 1);
}

export function InterviewRoom({ taskId, taskTitle, stages }: InterviewRoomProps) {
  const router = useRouter();
  const [storedSession, setStoredSession] = useState<StoredSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [completedQuestions, setCompletedQuestions] = useState<string[]>([]);

  useEffect(() => {
    let raw: string | null = null;

    try {
      raw = sessionStorage.getItem(storageKey(taskId));
    } catch {
      setMessage("Session data could not be loaded. Please restart from the practice page.");
      return;
    }

    if (!raw) {
      setMessage("No active session found. Please start again from the practice page.");
      return;
    }

    const parsed = safeParseStoredSession(raw);

    if (!parsed) {
      try {
        sessionStorage.removeItem(storageKey(taskId));
      } catch {
        // Storage may be unavailable; the restart guidance below is still enough.
      }
      setMessage("Session data could not be loaded. Please restart from the practice page.");
      return;
    }

    setStoredSession(parsed);
    setCompletedQuestions(parsed.completedQuestionIds ?? []);
    setCurrentIndex(initialQuestionIndex(parsed));
  }, [taskId]);

  const questions = useMemo(() => storedSession?.outline.questions ?? [], [storedSession]);
  const currentQuestion: TrainingQuestion | undefined = questions[currentIndex];
  const currentStage = currentQuestion?.stage ?? stages[0]?.type;

  async function submitAnswer() {
    if (!storedSession || !currentQuestion || !answer.trim()) {
      setMessage("Add an answer before moving on.");
      return;
    }

    setState("saving");
    setMessage("");

    try {
      const response = await fetch(`/api/sessions/${storedSession.sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: currentQuestion.stage,
          question: currentQuestion.prompt,
          answer
        })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setMessage(payload?.error || "Could not save this answer.");
        return;
      }

      const nextCompletedQuestions = completedQuestions.includes(currentQuestion.id)
        ? completedQuestions
        : [...completedQuestions, currentQuestion.id];
      const nextIndex = Math.min(currentIndex + 1, Math.max(questions.length - 1, 0));

      try {
        sessionStorage.setItem(
          storageKey(taskId),
          JSON.stringify({
            ...storedSession,
            currentQuestionIndex: nextIndex,
            completedQuestionIds: nextCompletedQuestions
          })
        );
      } catch {
        setMessage("Answer saved, but progress could not be stored in this browser.");
      }

      setCompletedQuestions(nextCompletedQuestions);
      setAnswer("");
      setCurrentIndex(nextIndex);
    } catch {
      setMessage("Could not reach the server. Your answer was not saved.");
    } finally {
      setState("idle");
    }
  }

  async function completeSession() {
    if (!storedSession) {
      setMessage("No active session found.");
      return;
    }

    setState("completing");
    setMessage("");

    try {
      const response = await fetch(`/api/sessions/${storedSession.sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setMessage(payload?.error || "Could not complete this session.");
        return;
      }

      sessionStorage.removeItem(storageKey(taskId));
      router.push(`/practice/${taskId}/report` as Route);
    } catch {
      setMessage("Could not reach the server. Please try completing again.");
    } finally {
      setState("idle");
    }
  }

  if (!storedSession) {
    return (
      <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">{taskTitle}</h1>
        <p className="mt-3 text-sm text-muted">{message || "Loading session..."}</p>
        <Link className="mt-5 inline-flex text-sm font-medium text-brand" href={`/practice/${taskId}` as Route}>
          Return to practice entry
        </Link>
      </div>
    );
  }

  const allAnswered = questions.length > 0 && completedQuestions.length >= questions.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h2 className="font-semibold text-ink">Progress</h2>
        <p className="mt-1 text-sm text-muted">
          {completedQuestions.length} / {questions.length} answered
        </p>
        <div className="mt-4">
          <StageTimeline stages={stages} currentStage={currentStage} />
        </div>
      </aside>

      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand">Interview room</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{taskTitle}</h1>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
            Question {Math.min(currentIndex + 1, questions.length)} / {questions.length}
          </span>
        </div>

        {currentQuestion ? (
          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{currentQuestion.stage}</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">{currentQuestion.prompt}</h2>
            {currentQuestion.followUps.length > 0 ? (
              <p className="mt-3 text-sm leading-6 text-muted">{currentQuestion.followUps[0]}</p>
            ) : null}
            {allAnswered ? (
              <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                All generated questions have been answered. Complete the session to generate the report.
              </div>
            ) : (
              <textarea
                aria-label="Candidate answer"
                className="mt-5 min-h-44 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type the candidate transcript or answer here."
              />
            )}
            {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Button className="gap-2" disabled={state !== "idle" || allAnswered} onClick={submitAnswer}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {state === "saving" ? "Saving..." : "Submit answer"}
              </Button>
              <Button
                className="gap-2"
                disabled={state !== "idle" || (!allAnswered && completedQuestions.length === 0)}
                variant="secondary"
                onClick={completeSession}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {state === "completing" ? "Completing..." : "Complete session"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-md border border-dashed border-line p-5">
            <p className="text-sm text-muted">No questions were generated for this session.</p>
            {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}

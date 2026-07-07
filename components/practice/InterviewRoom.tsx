"use client";

import type { Route } from "next";
import Link from "next/link";
import { CheckCircle2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { TrainingOutline, TrainingQuestion } from "@/lib/ai";
import type { StagePlanItem } from "@/lib/domain/stages";
import { CandidateMediaPanel } from "./CandidateMediaPanel";
import { DigitalInterviewerVideo } from "./DigitalInterviewerVideo";
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
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <aside className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h2 className="font-semibold text-ink">面试进度</h2>
        <p className="mt-1 text-sm text-muted">
          已完成 {completedQuestions.length} / {questions.length} 题
        </p>
        <div className="mt-4">
          <StageTimeline stages={stages} currentStage={currentStage} />
        </div>
      </aside>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand">数字人视频面试间</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{taskTitle}</h1>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
            第 {Math.min(currentIndex + 1, questions.length)} / {questions.length} 题
          </span>
        </div>

        {currentQuestion ? (
          <>
            <DigitalInterviewerVideo
              interviewerName="AI 面试官"
              stage={stageDisplayName(currentQuestion.stage)}
              prompt={currentQuestion.prompt}
              status={allAnswered ? "listening" : "speaking"}
            />

            <CandidateMediaPanel onTranscript={(text) => setAnswer(text)} />

            <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-brand">候选人回答</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink">语音转文字 / 手动输入</h2>
                </div>
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">录入后进入下一问</span>
              </div>

              {currentQuestion.followUps.length > 0 ? (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                  可能追问：{currentQuestion.followUps[0]}
                </div>
              ) : null}

              {allAnswered ? (
                <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  所有问题已完成。点击完成面试，生成训练报告。
                </div>
              ) : (
                <textarea
                  aria-label="Candidate answer"
                  className="mt-5 min-h-40 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="这里模拟语音转文字。你可以直接输入候选人的回答。"
                />
              )}
              {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button className="gap-2" disabled={state !== "idle" || allAnswered} onClick={submitAnswer}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {state === "saving" ? "保存中..." : "提交回答，进入下一问"}
                </Button>
                <Button
                  className="gap-2"
                  disabled={state !== "idle" || (!allAnswered && completedQuestions.length === 0)}
                  variant="secondary"
                  onClick={completeSession}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {state === "completing" ? "生成中..." : "完成面试并生成报告"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-line p-5">
            <p className="text-sm text-muted">本次训练没有生成面试问题。</p>
            {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}

function stageDisplayName(stage: string) {
  const names: Record<string, string> = {
    WARM_UP: "预热练习",
    FORMAL_INTERVIEW: "正式面试",
    PRESSURE_FOLLOW_UP: "压力追问",
    EXPERIENCE_DEEP_DIVE: "经历深挖",
    CASE_ANALYSIS: "案例分析",
    ENGLISH_INTERVIEW: "英文面试",
    AI_REVIEW: "AI 复盘",
    FOLLOW_UP_PLAN: "复训计划"
  };

  return names[stage] ?? stage;
}

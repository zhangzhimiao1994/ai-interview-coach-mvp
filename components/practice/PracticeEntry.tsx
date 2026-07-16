"use client";

import type { Route } from "next";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { TrainingOutline } from "@/lib/ai";
import type { StagePlanItem } from "@/lib/domain/stages";
import { DigitalInterviewerVideo } from "./DigitalInterviewerVideo";
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
  message?: string;
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
        setMessage(payload?.message || payload?.error || "Could not start this practice session.");
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

  const firstStage = stages[0];
  const previewPrompt = `你好，${task.candidateName}。我是 ${task.interviewerName}，接下来会以 ${task.targetCompany} ${task.targetRole} 的真实面试节奏和你进行演练。准备好后，我们先从自我介绍开始。`;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="grid gap-4">
        <DigitalInterviewerVideo
          interviewerName={task.interviewerName}
          stage={firstStage ? stageDisplayName(firstStage.type, firstStage.label) : "候场准备"}
          prompt={previewPrompt}
          status="ready"
        />

        <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-brand">视频面试候场室</p>
              <h1 className="mt-2 text-2xl font-semibold text-ink">{task.title}</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                数字人面试官会按公司、岗位和阶段配置进行提问、追问和复盘。
              </p>
            </div>
            <Button className="gap-2" disabled={isStarting || stages.length === 0} onClick={startPractice}>
              <Play className="h-4 w-4" aria-hidden="true" />
              {isStarting ? "正在进入..." : "进入视频面试"}
            </Button>
          </div>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="求职者" value={task.candidateName} />
            <InfoItem label="目标公司" value={task.targetCompany} />
            <InfoItem label="目标岗位" value={task.targetRole} />
            <InfoItem label="预计时长" value={`${task.expectedMinutes} 分钟`} />
          </dl>

          {message ? <p className="mt-5 text-sm text-red-600">{message}</p> : null}
        </section>
      </div>

      <aside className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <h2 className="font-semibold text-ink">面试阶段</h2>
        <p className="mt-1 text-sm text-muted">阶段切换会在面试间显示，方便你知道当前训练重点。</p>
        <div className="mt-4">
          <StageTimeline stages={stages} currentStage={stages[0]?.type} />
        </div>
      </aside>
    </div>
  );
}

function stageDisplayName(type: string, fallback: string) {
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

  return names[type] ?? fallback;
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}

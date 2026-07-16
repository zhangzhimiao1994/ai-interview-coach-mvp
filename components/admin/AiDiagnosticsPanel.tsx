"use client";

import { Activity, RefreshCw, Wifi } from "lucide-react";
import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  isTextDiagnosticCapability,
  type AiDiagnosticResult,
  type AiDiagnosticStatus
} from "@/lib/ai/diagnosticTypes";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";

type AiDiagnosticsPanelProps = {
  initialDiagnostics: AiDiagnosticResult[];
};

const capabilityLabels: Record<AiCapability, string> = {
  INTERVIEW_DIALOGUE: "实时面试对话",
  INTERVIEW_OUTLINE: "面试提纲生成",
  INTERVIEW_FOLLOW_UP: "面试追问",
  REPORT_ANALYSIS: "报告分析",
  COMPANY_RESEARCH: "公司/岗位研究",
  SPEECH_TO_TEXT: "语音识别",
  TEXT_TO_SPEECH: "语音合成",
  DIGITAL_HUMAN_REALTIME: "实时数字人",
  DIGITAL_HUMAN_VIDEO: "数字人视频",
  VISION_BEHAVIOR_ANALYSIS: "神态/行为分析",
  EMBEDDING: "知识库向量",
  SAFETY_REVIEW: "安全复核"
};

const statusPresentation: Record<
  AiDiagnosticStatus,
  { label: string; className: string }
> = {
  AVAILABLE: {
    label: "真实服务可用",
    className: "bg-emerald-50 text-emerald-700"
  },
  CONFIG_VALID: {
    label: "配置有效",
    className: "bg-blue-50 text-brand"
  },
  CONFIGURED_NOT_ADAPTED: {
    label: "已配置，等待适配器",
    className: "bg-amber-50 text-amber-700"
  },
  NOT_SELECTED: {
    label: "未选择当前模型",
    className: "bg-slate-100 text-muted"
  },
  MISCONFIGURED: {
    label: "配置不完整",
    className: "bg-rose-50 text-rose-700"
  },
  UNREACHABLE: {
    label: "真实服务不可达",
    className: "bg-rose-50 text-rose-700"
  }
};

function checkedAtLabel(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return "检查时间未知";
  }

  return `${timestamp.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function AiDiagnosticsPanel({
  initialDiagnostics
}: AiDiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics);
  const [checking, setChecking] = useState<Partial<Record<AiCapability, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AiCapability, string>>>({});

  async function runDiagnostic(capability: AiCapability, liveCheck: boolean) {
    setChecking((current) => ({ ...current, [capability]: true }));
    setErrors((current) => ({ ...current, [capability]: "" }));

    try {
      const response = await fetch("/api/ai-services/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability, liveCheck })
      });
      const payload = (await response.json()) as {
        diagnostic?: AiDiagnosticResult;
      };

      if (!response.ok || !payload.diagnostic) {
        throw new Error("Diagnostic request failed");
      }

      setDiagnostics((current) =>
        current.map((item) =>
          item.capability === capability ? payload.diagnostic! : item
        )
      );
    } catch {
      setErrors((current) => ({
        ...current,
        [capability]: "检查失败，请稍后重试。"
      }));
    } finally {
      setChecking((current) => ({ ...current, [capability]: false }));
    }
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="font-semibold text-ink">配置诊断</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            首屏只读取当前配置，不会自动触发付费请求。真实连通测试必须由管理员主动执行。
          </p>
        </div>
        <span className="rounded-md bg-slate-100 px-3 py-1 text-xs text-muted">
          {diagnostics.length} 项能力
        </span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {diagnostics.map((diagnostic) => {
          const status = statusPresentation[diagnostic.status];
          const isChecking = Boolean(checking[diagnostic.capability]);
          const supportsLiveCheck = isTextDiagnosticCapability(
            diagnostic.capability
          );

          return (
            <article
              key={diagnostic.capability}
              className="rounded-md border border-line p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-ink">
                    {capabilityLabels[diagnostic.capability]}
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    {diagnostic.providerName && diagnostic.modelDisplayName
                      ? `${diagnostic.providerName} / ${diagnostic.modelDisplayName}`
                      : "尚未配置当前使用模型"}
                  </p>
                  {diagnostic.modelName ? (
                    <p className="mt-1 break-all text-xs text-muted">
                      {diagnostic.modelName}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`rounded-md px-2 py-1 text-xs ${status.className}`}
                >
                  {status.label}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-muted">
                {diagnostic.message}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>{diagnostic.checkMode === "LIVE" ? "真实检查" : "配置检查"}</span>
                <span>{diagnostic.latencyMs} ms</span>
                <span>{checkedAtLabel(diagnostic.checkedAt)}</span>
              </div>

              {errors[diagnostic.capability] ? (
                <p className="mt-3 text-sm text-rose-700">
                  {errors[diagnostic.capability]}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  className="min-h-8 gap-1 px-3 py-1 text-xs"
                  type="button"
                  variant="secondary"
                  disabled={isChecking}
                  onClick={() => runDiagnostic(diagnostic.capability, false)}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {isChecking ? "检查中..." : "检查配置"}
                </Button>
                <Button
                  className="min-h-8 gap-1 px-3 py-1 text-xs"
                  type="button"
                  disabled={isChecking}
                  onClick={() => runDiagnostic(diagnostic.capability, true)}
                >
                  <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                  {supportsLiveCheck
                    ? "真实连通测试"
                    : "真实测试（当前仅配置）"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

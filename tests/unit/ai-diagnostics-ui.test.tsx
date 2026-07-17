import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiDiagnosticsPanel } from "@/components/admin/AiDiagnosticsPanel";
import type { AiDiagnosticResult } from "@/lib/ai/diagnosticTypes";

describe("AI diagnostics admin panel", () => {
  it("renders safe statuses and explicit manual diagnostic actions", () => {
    const markup = renderToStaticMarkup(
      <AiDiagnosticsPanel initialDiagnostics={diagnostics} />
    );

    expect(markup).toContain("配置诊断");
    expect(markup).toContain("不会自动触发付费请求");
    expect(markup).toContain("检查配置");
    expect(markup).toContain("真实连通测试");
    expect(markup).toContain("真实检查（可能计费）");
    expect(markup).toContain("配置有效");
    expect(markup).toContain("未选择当前模型");
    expect(markup).toContain("未配置");
    expect(markup).toContain("灵眸未配置，当前使用本地数字人");
    expect(markup).toContain("Alibaba Cloud / Qwen Plus");
    expect(markup).toContain("qwen-plus");
    expect(markup).not.toContain("ciphertext");
    expect(markup).not.toContain("rtc-secret-sentinel");
  });
});

const diagnostics: AiDiagnosticResult[] = [
  {
    capability: "INTERVIEW_DIALOGUE",
    providerName: "Alibaba Cloud",
    modelDisplayName: "Qwen Plus",
    modelName: "qwen-plus",
    checkMode: "CONFIG",
    status: "CONFIG_VALID",
    code: "CONFIG_VALID",
    latencyMs: 4,
    message: "配置检查通过，未执行真实请求。",
    checkedAt: "2026-07-16T08:00:00.000Z"
  },
  {
    capability: "COMPANY_RESEARCH",
    providerName: null,
    modelDisplayName: null,
    modelName: null,
    checkMode: "CONFIG",
    status: "NOT_SELECTED",
    code: "MODEL_NOT_SELECTED",
    latencyMs: 1,
    message: "该能力尚未选择当前使用模型。",
    checkedAt: "2026-07-16T08:00:00.000Z"
  },
  {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerName: "Alibaba Cloud",
    modelDisplayName: "Avatar Dialog",
    modelName: "avatar-dialog",
    checkMode: "CONFIG",
    status: "NOT_CONFIGURED",
    code: "LINGMOU_NOT_CONFIGURED",
    latencyMs: 3,
    message: "灵眸未配置，当前使用本地数字人",
    checkedAt: "2026-07-16T08:00:00.000Z"
  }
];

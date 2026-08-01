import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { providerFindMany, modelFindMany, runtimeSettingFindUnique, profileFindMany, storageFindFirst, getAllAiDiagnostics } = vi.hoisted(() => ({
  providerFindMany: vi.fn(),
  modelFindMany: vi.fn(),
  runtimeSettingFindUnique: vi.fn(),
  profileFindMany: vi.fn(),
  storageFindFirst: vi.fn(),
  getAllAiDiagnostics: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    aiServiceProvider: { findMany: providerFindMany },
    aiModelConfig: { findMany: modelFindMany },
    aiRuntimeSetting: { findUnique: runtimeSettingFindUnique },
    interviewerAvatarProfile: { findMany: profileFindMany },
    mediaStorageConfig: { findFirst: storageFindFirst }
  }
}));

vi.mock("@/lib/ai/diagnostics", () => ({ getAllAiDiagnostics }));

describe("AI services admin page diagnostics", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    providerFindMany.mockReset().mockResolvedValue([]);
    modelFindMany.mockReset().mockResolvedValue([]);
    profileFindMany.mockReset().mockResolvedValue([]);
    storageFindFirst.mockReset().mockResolvedValue(null);
    runtimeSettingFindUnique.mockReset().mockResolvedValue({
      valueJson: JSON.stringify({
        enabled: true,
        modelId: "model-omni",
        coveredCapabilities: ["INTERVIEW_FOLLOW_UP"]
      })
    });
    getAllAiDiagnostics.mockReset().mockResolvedValue([
      {
        capability: "INTERVIEW_DIALOGUE",
        providerName: "Alibaba Cloud",
        modelDisplayName: "Qwen Plus",
        modelName: "qwen-plus",
        checkMode: "CONFIG",
        status: "CONFIG_VALID",
        code: "CONFIG_VALID",
        latencyMs: 3,
        message: "配置检查通过，未执行真实请求。",
        checkedAt: "2026-07-16T08:00:00.000Z"
      }
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads configuration-only diagnostics for the first server render", async () => {
    const { default: AiServicesPage } = await import("@/app/admin/ai-services/page");

    const markup = renderToStaticMarkup(await AiServicesPage());

    expect(getAllAiDiagnostics).toHaveBeenCalledTimes(1);
    expect(providerFindMany).toHaveBeenCalledTimes(1);
    expect(modelFindMany).toHaveBeenCalledTimes(1);
    expect(runtimeSettingFindUnique).toHaveBeenCalledWith({
      where: { key: "ai.multimodalTakeover" }
    });
    expect(markup).toContain('name="multimodalTakeoverEnabled"');
    expect(markup).toContain("配置诊断");
    expect(markup).toContain("Alibaba Cloud / Qwen Plus");
    expect(markup).toContain("不会自动触发付费请求");
  });
});

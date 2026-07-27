import { beforeEach, describe, expect, it, vi } from "vitest";

const { diagnoseAiCapability, getAllAiDiagnostics } = vi.hoisted(() => ({
  diagnoseAiCapability: vi.fn(),
  getAllAiDiagnostics: vi.fn()
}));

vi.mock("@/lib/ai/diagnostics", () => ({
  diagnoseAiCapability,
  getAllAiDiagnostics
}));

function diagnostic(overrides: Record<string, unknown> = {}) {
  return {
    capability: "INTERVIEW_DIALOGUE",
    providerName: "Alibaba Cloud",
    modelDisplayName: "Qwen Plus",
    modelName: "qwen-plus",
    checkMode: "CONFIG",
    status: "CONFIG_VALID",
    code: "CONFIG_VALID",
    latencyMs: 3,
    message: "配置检查通过。",
    checkedAt: "2026-07-16T08:00:00.000Z",
    ...overrides
  };
}

describe("AI diagnostics API route", () => {
  beforeEach(() => {
    diagnoseAiCapability.mockReset();
    getAllAiDiagnostics.mockReset();
  });

  it("returns every capability summary without starting live checks", async () => {
    getAllAiDiagnostics.mockResolvedValue([
      diagnostic({ capability: "INTERVIEW_DIALOGUE" })
    ]);
    const { GET } = await import("@/app/api/ai-services/diagnostics/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      diagnostics: [
        expect.objectContaining({
          capability: "INTERVIEW_DIALOGUE",
          checkMode: "CONFIG"
        })
      ]
    });
    expect(getAllAiDiagnostics).toHaveBeenCalledTimes(1);
    expect(diagnoseAiCapability).not.toHaveBeenCalled();
  }, 15_000);

  it("validates and runs one requested live check", async () => {
    diagnoseAiCapability.mockResolvedValue(
      diagnostic({ status: "AVAILABLE", checkMode: "LIVE" })
    );
    const { POST } = await import("@/app/api/ai-services/diagnostics/route");

    const response = await POST(
      new Request("http://localhost/api/ai-services/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "INTERVIEW_DIALOGUE",
          liveCheck: true
        })
      })
    );

    expect(response.status).toBe(200);
    expect(diagnoseAiCapability).toHaveBeenCalledWith(
      "INTERVIEW_DIALOGUE",
      { liveCheck: true }
    );
    await expect(response.json()).resolves.toEqual({
      diagnostic: expect.objectContaining({
        status: "AVAILABLE",
        checkMode: "LIVE"
      })
    });
  });

  it("rejects unknown capabilities without running a diagnostic", async () => {
    const { POST } = await import("@/app/api/ai-services/diagnostics/route");

    const response = await POST(
      new Request("http://localhost/api/ai-services/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "UNKNOWN", liveCheck: true })
      })
    );

    expect(response.status).toBe(400);
    expect(diagnoseAiCapability).not.toHaveBeenCalled();
  });
});

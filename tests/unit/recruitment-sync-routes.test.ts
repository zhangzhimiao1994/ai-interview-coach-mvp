import { afterEach, describe, expect, it, vi } from "vitest";

function jsonRequest(body: unknown, url = "http://localhost/api/recruitment/sync-runs") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("recruitment sync run routes", () => {
  it("starts a manual sync with selected template and sources", async () => {
    const runRecruitmentSync = vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "SUCCESS",
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      logs: []
    });
    vi.doMock("@/lib/recruitment/sync", async () => {
      const actual = await vi.importActual<typeof import("@/lib/recruitment/sync")>("@/lib/recruitment/sync");
      return { ...actual, runRecruitmentSync };
    });

    const route = await import("@/app/api/recruitment/sync-runs/route");
    const response = await route.POST(jsonRequest({
      templateId: "template-1",
      sourceIds: ["source-1"],
      mode: "MANUAL"
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(runRecruitmentSync.mock.calls[0][0]).toMatchObject({
      templateId: "template-1",
      sourceIds: ["source-1"],
      mode: "MANUAL"
    });
    expect(payload.run.status).toBe("SUCCESS");
  });

  it("lists recent sync runs with redacted logs", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    const prisma = {
      recruitmentSyncRun: {
        findMany: vi.fn().mockResolvedValue([{
          id: "run-1",
          sourceId: "source-1",
          templateId: "template-1",
          mode: "MANUAL",
          status: "AUTH_REQUIRED",
          insertedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          failureReason: "AUTH_REQUIRED",
          logsJson: JSON.stringify([{ provider: "adzuna", message: "apiKey=[REDACTED]" }]),
          startedAt: now,
          finishedAt: now,
          createdAt: now
        }])
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/recruitment/sync-runs/route");
    const response = await route.GET(new Request("http://localhost/api/recruitment/sync-runs"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.recruitmentSyncRun.findMany).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
      take: 50
    });
    expect(payload.runs[0].status).toBe("AUTH_REQUIRED");
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});

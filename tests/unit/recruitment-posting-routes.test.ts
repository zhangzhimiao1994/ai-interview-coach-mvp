import { afterEach, describe, expect, it, vi } from "vitest";
import { parseManualRecruitmentPostingInput } from "@/lib/validators/recruitment";

function jsonRequest(body: unknown, url = "http://localhost/api/recruitment/postings") {
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

describe("recruitment posting validators and routes", () => {
  it("validates manual imports with strict required fields", () => {
    expect(() => parseManualRecruitmentPostingInput({ title: "", description: "x" })).toThrow();
    expect(parseManualRecruitmentPostingInput({ title: "Frontend", description: "Build UI" })).toMatchObject({
      title: "Frontend",
      provider: "manual",
      sourceType: "MANUAL"
    });
  });

  it("creates a manual posting through the job library without leaking raw fields", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    const prisma = {
      recruitmentJobPosting: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({
          id: "posting-1",
          ...create,
          createdAt: now,
          updatedAt: now,
          firstSeenAt: now,
          lastSeenAt: now
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/recruitment/postings/route");
    const response = await route.POST(jsonRequest({
      title: "Senior Frontend Engineer",
      company: "Acme",
      description: "Build interview products.",
      requirementsText: "React\nTypeScript",
      sourceUrl: "https://jobs.example.com/role?utm_source=test",
      notes: "Ask about real-time UI."
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(prisma.recruitmentJobPosting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupeKey: "url:https://jobs.example.com/role" }
    }));
    expect(payload.posting).toMatchObject({
      id: "posting-1",
      provider: "manual",
      title: "Senior Frontend Engineer",
      sourceUrl: "https://jobs.example.com/role",
      requirements: ["React", "TypeScript"]
    });
    expect(JSON.stringify(payload)).not.toContain("requirementsJson");
    expect(JSON.stringify(payload)).not.toContain("rawJson");
  });
});

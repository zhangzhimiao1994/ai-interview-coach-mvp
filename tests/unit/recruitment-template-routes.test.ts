import { afterEach, describe, expect, it, vi } from "vitest";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/recruitment/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("recruitment template routes", () => {
  it("creates search templates with selected sources and candidate bindings", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const prisma = {
      recruitmentSearchTemplate: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "template-1",
          ...data,
          candidateLinks: data.candidateLinks?.create || [],
          createdAt: now,
          updatedAt: now
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/recruitment/templates/route");
    const response = await route.POST(jsonRequest({
      name: "Frontend global",
      keywords: "React TypeScript",
      city: "Remote",
      country: "US",
      sourceIds: ["source-1", "source-2"],
      candidateIds: ["candidate-1"],
      enabled: true
    }));
    const payload = await response.json();
    const createData = prisma.recruitmentSearchTemplate.create.mock.calls[0][0].data;

    expect(response.status).toBe(201);
    expect(createData.sourceIdsJson).toBe(JSON.stringify(["source-1", "source-2"]));
    expect(createData.candidateLinks.create).toEqual([{ candidateId: "candidate-1" }]);
    expect(payload.template.sourceIds).toEqual(["source-1", "source-2"]);
    expect(payload.template.candidateIds).toEqual(["candidate-1"]);
  });
});

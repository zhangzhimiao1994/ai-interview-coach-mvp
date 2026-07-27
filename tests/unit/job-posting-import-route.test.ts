import { afterEach, describe, expect, it, vi } from "vitest";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/job-postings/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("job posting import route", () => {
  it("imports a public global ATS job page without exposing raw HTML", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `<html><body>
          <h1>Machine Learning Engineer</h1>
          <div class="company-name">Acme AI</div>
          <p>Build real-time interview intelligence systems.</p>
          <ul><li>3+ years building production ML systems.</li></ul>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const route = await import("@/app/api/job-postings/import/route");
    const response = await route.POST(jsonRequest({ url: "https://jobs.lever.co/acme/ml-engineer" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://jobs.lever.co/acme/ml-engineer",
      expect.objectContaining({
        redirect: "follow",
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("AIInterviewCoach")
        })
      })
    );
    expect(payload.posting).toMatchObject({
      title: "Machine Learning Engineer",
      company: "Acme AI",
      sourceUrl: "https://jobs.lever.co/acme/ml-engineer"
    });
    expect(payload.posting.description).toContain("production ML systems");
    expect(JSON.stringify(payload)).not.toContain("<html>");
  });

  it("rejects private URLs without fetching them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const route = await import("@/app/api/job-postings/import/route");
    const response = await route.POST(jsonRequest({ url: "http://127.0.0.1:3000/admin" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Job source URL must be a public HTTP(S) URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a paste-required response for login or anti-bot pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html><body>Sign in to view this job</body></html>", { status: 200 }))
    );

    const route = await import("@/app/api/job-postings/import/route");
    const response = await route.POST(jsonRequest({ url: "https://www.linkedin.com/jobs/view/123" }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.code).toBe("PASTE_REQUIRED");
    expect(payload.message).toContain("粘贴");
  });
});

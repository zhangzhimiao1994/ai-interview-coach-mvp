import { describe, expect, it } from "vitest";
import { parseTrainingTaskInput } from "@/lib/validators/task";

describe("training task recruitment snapshot", () => {
  it("accepts a selected job posting id with copied job fields", () => {
    const parsed = parseTrainingTaskInput({
      candidateId: "candidate-1",
      title: "Practice",
      targetCompany: "Acme",
      targetRole: "Frontend",
      jobPostingId: "posting-1",
      jobSourceUrl: "https://jobs.example.com/frontend",
      jobDescription: "Build UI",
      jobManualNotes: "Ask state management.",
      expectedMinutes: 30,
      stageConfig: [{ type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 20, visibleTransition: true }]
    });

    expect(parsed.jobPostingId).toBe("posting-1");
    expect(parsed.jobDescription).toContain("Build UI");
    expect(parsed.jobManualNotes).toBe("Ask state management.");
  });
});

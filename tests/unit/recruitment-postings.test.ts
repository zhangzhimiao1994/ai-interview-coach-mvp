import { describe, expect, it } from "vitest";
import { createManualRecruitmentPostingInput, toTrainingTaskJobSnapshot } from "@/lib/recruitment/postings";

describe("manual recruitment postings", () => {
  it("normalizes manual import into a job library posting", () => {
    const posting = createManualRecruitmentPostingInput({
      title: "Senior Frontend Engineer",
      company: "Acme",
      location: "Remote",
      salary: "50k-70k",
      description: "Build interview products.",
      requirementsText: "React\nTypeScript",
      sourceUrl: "https://jobs.example.com/role?utm_source=test",
      notes: "Ask about real-time UI."
    });

    expect(posting.provider).toBe("manual");
    expect(posting.sourceType).toBe("MANUAL");
    expect(posting.requirements).toEqual(["React", "TypeScript"]);
    expect(posting.sourceUrl).toBe("https://jobs.example.com/role");
    expect(posting.manualImport).toBe(true);
    expect(posting.dedupeKey).toBe("url:https://jobs.example.com/role");
  });

  it("copies an immutable snapshot for training tasks", () => {
    const snapshot = toTrainingTaskJobSnapshot({
      id: "job-1",
      title: "Backend Engineer",
      company: "Acme",
      sourceUrl: "https://jobs.example.com/backend",
      description: "Own APIs.",
      requirementsJson: JSON.stringify(["Node.js"]),
      editedNotes: "Probe API design."
    });

    expect(snapshot).toEqual({
      jobPostingId: "job-1",
      targetRole: "Backend Engineer",
      targetCompany: "Acme",
      jobSourceUrl: "https://jobs.example.com/backend",
      jobDescription: "Own APIs.\n\nRequirements:\n- Node.js",
      jobManualNotes: "Probe API design."
    });
  });
});

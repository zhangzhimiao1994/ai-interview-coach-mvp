import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("training task job posting import UI", () => {
  it("exposes global recruitment import, paste fallback and manual notes fields", () => {
    const source = readFileSync(join(process.cwd(), "components/admin/TrainingTaskForm.tsx"), "utf8");

    expect(source).toContain("/api/job-postings/import");
    expect(source).toContain("国内外招聘链接");
    expect(source).toContain("LinkedIn");
    expect(source).toContain("Greenhouse");
    expect(source).toContain("Lever");
    expect(source).toContain('name="jobSourceUrl"');
    expect(source).toContain('name="jobDescription"');
    expect(source).toContain('name="jobManualNotes"');
    expect(source).toContain('jobSourceUrl: form.get("jobSourceUrl")');
    expect(source).toContain('jobDescription: form.get("jobDescription")');
    expect(source).toContain('jobManualNotes: form.get("jobManualNotes")');
  });
});

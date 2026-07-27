import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("recruitment migration", () => {
  it("creates recruitment tables, indexes, and training task link", () => {
    const sql = readFileSync("prisma/migrations/20260727120000_add_recruitment_collection/migration.sql", "utf8");
    expect(sql).toContain("CREATE TABLE \"RecruitmentSource\"");
    expect(sql).toContain("CREATE TABLE \"RecruitmentJobPosting\"");
    expect(sql).toContain("CREATE TABLE \"RecruitmentSyncRun\"");
    expect(sql).toContain("ALTER TABLE \"TrainingTask\" ADD COLUMN \"jobPostingId\" TEXT");
    expect(sql).toContain("CREATE UNIQUE INDEX \"RecruitmentJobPosting_provider_externalJobId_key\"");
  });
});

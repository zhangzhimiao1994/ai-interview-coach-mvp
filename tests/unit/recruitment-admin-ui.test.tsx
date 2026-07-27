import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { RecruitmentJobLibraryPanel } from "@/components/admin/recruitment/RecruitmentJobLibraryPanel";
import { RecruitmentSourcePanel } from "@/components/admin/recruitment/RecruitmentSourcePanel";
import { RecruitmentSyncRunPanel } from "@/components/admin/recruitment/RecruitmentSyncRunPanel";
import { RecruitmentTemplatePanel } from "@/components/admin/recruitment/RecruitmentTemplatePanel";

describe("recruitment admin UI", () => {
  it("shows manual import, sources, templates, job library, and sync runs", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <div>
          <RecruitmentSourcePanel sources={[]} />
          <RecruitmentTemplatePanel templates={[]} sources={[]} />
          <RecruitmentJobLibraryPanel postings={[]} />
          <RecruitmentSyncRunPanel runs={[]} templates={[]} sources={[]} />
        </div>
      );
    });
    const tree = renderer!.toJSON();
    const text = JSON.stringify(tree);

    expect(text).toContain("Recruitment sources");
    expect(text).toContain("Search templates");
    expect(text).toContain("Job library");
    expect(text).toContain("Manual import");
    expect(text).toContain("Sync runs");
  });
});

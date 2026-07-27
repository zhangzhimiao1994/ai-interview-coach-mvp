import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingTaskForm } from "@/components/admin/TrainingTaskForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function inputValueByName(renderer: TestRenderer.ReactTestRenderer, name: string) {
  return renderer.root.findAll((node) => node.props.name === name)[0].props.value;
}

describe("recruitment training task UI", () => {
  it("copies a selected job library posting into the task snapshot fields", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TrainingTaskForm
          candidates={[{ id: "candidate-1", name: "Alice", targetCompany: "", targetRole: "" }]}
          companies={[]}
          jobs={[]}
          interviewers={[]}
          jobPostings={[{
            id: "posting-1",
            title: "Frontend Engineer",
            company: "Acme",
            sourceUrl: "https://jobs.example.com/frontend",
            description: "Build UI systems",
            requirements: ["React", "TypeScript"],
            editedNotes: "Probe state management."
          }]}
        />
      );
    });
    const jobPostingSelect = renderer!.root.findAll((node) => node.props.name === "jobPostingId")[0];

    act(() => {
      jobPostingSelect.props.onChange({ target: { value: "posting-1" } });
    });

    expect(inputValueByName(renderer!, "targetCompany")).toBe("Acme");
    expect(inputValueByName(renderer!, "targetRole")).toBe("Frontend Engineer");
    expect(inputValueByName(renderer!, "jobSourceUrl")).toBe("https://jobs.example.com/frontend");
    expect(inputValueByName(renderer!, "jobDescription")).toContain("Build UI systems");
    expect(inputValueByName(renderer!, "jobDescription")).toContain("React");
    expect(inputValueByName(renderer!, "jobManualNotes")).toBe("Probe state management.");
  });
});

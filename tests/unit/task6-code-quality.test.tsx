import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "@/components/ui/Field";

const root = process.cwd();

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("Task 6 code quality", () => {
  it("renders active practice links and report links for sessions with reports", () => {
    const page = readWorkspaceFile("app/admin/tasks/[taskId]/page.tsx");

    expect(page).toContain("href={practiceUrl as Route}");
    expect(page).toContain("session.report ? (");
    expect(page).toContain('href={`/admin/reports/${session.id}` as Route}');
  });

  it.each([
    ["candidate form", "components/admin/CandidateForm.tsx"],
    ["training task form", "components/admin/TrainingTaskForm.tsx"]
  ])("%s recovers from rejected submit requests", (_, path) => {
    const source = readWorkspaceFile(path);

    expect(source).toMatch(/try\s*{/);
    expect(source).toMatch(/catch\s*(?:\([^)]*\))?\s*{/);
    expect(source).toMatch(/finally\s*{/);
  });

  it("connects field labels, hints, and errors with stable accessibility attributes", () => {
    const markup = renderToStaticMarkup(<Field label="Email" name="email" hint="Use work email" error="Invalid email" />);
    const inputId = markup.match(/<input[^>]*id="([^"]+)"/)?.[1];

    expect(inputId).toBeTruthy();
    expect(markup).toMatch(new RegExp(`<label[^>]*for="${inputId}"`));
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(`aria-describedby="${inputId}-hint ${inputId}-error"`);
    expect(markup).toContain(`id="${inputId}-hint"`);
    expect(markup).toContain(`id="${inputId}-error"`);
  });
});

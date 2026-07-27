import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("admin navigation", () => {
  it("uses a shared admin shell on AI configuration pages", () => {
    const page = readWorkspaceFile("app/admin/ai-services/page.tsx");

    expect(page).toContain("AdminShell");
    expect(page).toContain("返回后台");
    expect(page).toContain("active=\"ai-services\"");
  });

  it("exposes detailed operations areas in the admin shell", () => {
    const shell = readWorkspaceFile("components/admin/AdminShell.tsx");

    expect(shell).toContain("总览");
    expect(shell).toContain("候选人");
    expect(shell).toContain("模板库");
    expect(shell).toContain("AI能力");
    expect(shell).toContain("数字人");
    expect(shell).toContain("行为分析");
    expect(shell).toContain("招聘数据");
    expect(shell).toContain("/admin/recruitment");
  });
});

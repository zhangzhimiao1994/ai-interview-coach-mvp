import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("application display name", () => {
  it("uses 开发面试数字人 in the browser title", () => {
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");

    expect(layout).toContain('title: "开发面试数字人"');
    expect(layout).not.toContain("AI 面试训练辅导平台");
  });

  it("uses the same display name on the public home page", () => {
    const homePage = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");

    expect(homePage).toContain("开发面试数字人");
    expect(homePage).not.toContain("AI Interview Coach MVP");
    expect(homePage).not.toContain("AI 数字人面试训练辅导平台");
  });
});

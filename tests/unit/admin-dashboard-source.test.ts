import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin dashboard source", () => {
  it("organizes the admin home as an operations console", () => {
    const source = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");

    expect(source).toContain("服务交付");
    expect(source).toContain("知识库");
    expect(source).toContain("AI能力");
    expect(source).toContain("数字人");
    expect(source).toContain("行为分析");
    expect(source).toContain("运营控制台");
  });
});

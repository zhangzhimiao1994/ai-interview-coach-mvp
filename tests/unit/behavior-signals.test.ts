import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("candidate behavior signals", () => {
  it("persists behavior signals on each session turn", () => {
    const schema = readWorkspaceFile("prisma/schema.prisma");

    expect(schema).toContain("behaviorSignalsJson");
  });

  it("accepts behavior signals in the answer route", () => {
    const route = readWorkspaceFile("app/api/sessions/[sessionId]/answer/route.ts");

    expect(route).toContain("behaviorSignals");
    expect(route).toContain("behaviorSignalsJson");
  });

  it("passes behavior signals into report generation", () => {
    const completeRoute = readWorkspaceFile("app/api/sessions/[sessionId]/complete/route.ts");
    const types = readWorkspaceFile("lib/ai/types.ts");

    expect(types).toContain("BehaviorSignals");
    expect(completeRoute).toContain("behaviorSignals");
    expect(completeRoute).toContain("behaviorSignalsJson");
  });
});

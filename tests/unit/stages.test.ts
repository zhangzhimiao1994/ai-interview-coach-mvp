import { describe, expect, it } from "vitest";
import { buildStagePlan, defaultStageTemplates, parseStageConfigInput } from "@/lib/domain/stages";

const validStageConfigs = [
  { type: "WARM_UP", enabled: true, durationMinutes: 5, visibleTransition: true },
  { type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 15, visibleTransition: false }
] as const;

describe("buildStagePlan", () => {
  it("returns only enabled stages in configured order", () => {
    const plan = buildStagePlan([
      { type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 15, visibleTransition: true },
      { type: "WARM_UP", enabled: false, durationMinutes: 5, visibleTransition: true },
      { type: "PRESSURE_FOLLOW_UP", enabled: true, durationMinutes: 8, visibleTransition: false }
    ]);

    expect(plan.map((stage) => stage.type)).toEqual(["FORMAL_INTERVIEW", "PRESSURE_FOLLOW_UP"]);
    expect(plan[1].visibleTransition).toBe(false);
  });

  it("contains the MVP default stage templates", () => {
    expect(defaultStageTemplates.map((stage) => stage.type)).toEqual([
      "WARM_UP",
      "FORMAL_INTERVIEW",
      "PRESSURE_FOLLOW_UP",
      "EXPERIENCE_DEEP_DIVE",
      "CASE_ANALYSIS",
      "ENGLISH_INTERVIEW",
      "AI_REVIEW",
      "FOLLOW_UP_PLAN"
    ]);
  });
});

describe("parseStageConfigInput", () => {
  it("accepts a valid JSON string", () => {
    expect(parseStageConfigInput(JSON.stringify(validStageConfigs))).toEqual(validStageConfigs);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseStageConfigInput("{invalid json")).toThrow();
  });

  it("rejects duplicate stages", () => {
    expect(() =>
      parseStageConfigInput([
        ...validStageConfigs,
        { type: "WARM_UP", enabled: false, durationMinutes: 3, visibleTransition: true }
      ])
    ).toThrow();
  });

  it("rejects invalid duration", () => {
    expect(() =>
      parseStageConfigInput([{ type: "WARM_UP", enabled: true, durationMinutes: 0, visibleTransition: true }])
    ).toThrow();
  });
});

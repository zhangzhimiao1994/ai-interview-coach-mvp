import { describe, expect, it } from "vitest";
import { getTopWeakTags, parseJsonList, parseJsonStringList } from "@/lib/domain/reports";

const isString = (item: unknown): item is string => typeof item === "string";

describe("parseJsonList", () => {
  it("parses JSON lists safely", () => {
    expect(parseJsonList(JSON.stringify(["communication", "structure"]))).toEqual([
      "communication",
      "structure"
    ]);
  });

  it("returns an empty list for invalid JSON", () => {
    expect(parseJsonList("{invalid json")).toEqual([]);
  });

  it("returns an empty list for non-array JSON", () => {
    expect(parseJsonList(JSON.stringify({ tag: "communication" }))).toEqual([]);
  });

  it("returns an empty list when any guarded item is invalid", () => {
    expect(parseJsonList<string>(JSON.stringify(["communication", 42]), isString)).toEqual([]);
  });
});

describe("parseJsonStringList", () => {
  it("parses guarded string lists", () => {
    expect(parseJsonStringList(JSON.stringify(["communication", "structure"]))).toEqual([
      "communication",
      "structure"
    ]);
  });

  it("returns an empty list for mixed item lists", () => {
    expect(parseJsonStringList(JSON.stringify(["communication", 42]))).toEqual([]);
  });
});

describe("getTopWeakTags", () => {
  it("limits top weak tags", () => {
    expect(getTopWeakTags(["clarity", "specificity", "confidence", "pace"], 2)).toEqual([
      "clarity",
      "specificity"
    ]);
  });

  it("returns no weak tags for a zero limit", () => {
    expect(getTopWeakTags(["clarity", "specificity"], 0)).toEqual([]);
  });

  it("returns no weak tags for a negative limit", () => {
    expect(getTopWeakTags(["clarity", "specificity"], -1)).toEqual([]);
  });

  it("returns no weak tags for a NaN limit", () => {
    expect(getTopWeakTags(["clarity", "specificity"], Number.NaN)).toEqual([]);
  });

  it("returns all weak tags when the limit exceeds the list length", () => {
    expect(getTopWeakTags(["clarity", "specificity"], 10)).toEqual(["clarity", "specificity"]);
  });
});

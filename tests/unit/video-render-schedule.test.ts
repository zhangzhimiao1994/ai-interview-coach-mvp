import { describe, expect, it } from "vitest";
import { getDueProviders } from "@/lib/media/video/renderSchedule";
import type { DigitalHumanVideoRuntimeSettings } from "@/lib/media/video/types";

const settings: DigitalHumanVideoRuntimeSettings = {
  mode: "AUTO_RACE",
  maxWaitMs: 8000,
  lingmouPollMs: [3000, 6000],
  emoPollMs: [8000],
  synchronizeProfiles: true,
  primaryProfileId: "primary",
  secondaryProfileId: null,
  lingmouModelId: "lingmou-model",
  emoModelId: "emo-model"
};

describe("video render polling schedule", () => {
  it.each([
    [2999, []],
    [3000, ["LINGMOU_BROADCAST"]],
    [6000, ["LINGMOU_BROADCAST"]],
    [8000, ["LINGMOU_BROADCAST", "ALIBABA_EMO"]]
  ] as const)("returns the exact due providers at %d ms", (elapsedMs, expected) => {
    expect(getDueProviders(elapsedMs, settings)).toEqual(expected);
  });

  it("filters the fixed schedule for provider-only modes", () => {
    expect(getDueProviders(8000, { ...settings, mode: "LINGMOU_ONLY" })).toEqual([
      "LINGMOU_BROADCAST"
    ]);
    expect(getDueProviders(8000, { ...settings, mode: "EMO_ONLY" })).toEqual([
      "ALIBABA_EMO"
    ]);
  });
});

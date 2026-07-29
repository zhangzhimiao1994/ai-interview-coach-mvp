import { describe, expect, it } from "vitest";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";

const validSettings = {
  mode: "AUTO_RACE",
  maxWaitMs: 8000,
  lingmouPollMs: [3000, 6000],
  emoPollMs: [8000],
  synchronizeProfiles: true,
  primaryProfileId: "profile-lingmou",
  secondaryProfileId: "profile-emo",
  lingmouModelId: "model-lingmou",
  emoModelId: "model-emo"
};

describe("digital human video runtime settings", () => {
  it("parses only the fixed dual-provider runtime contract", () => {
    expect(parseDigitalHumanVideoRuntimeSettings(JSON.stringify(validSettings))).toEqual(
      validSettings
    );
  });

  it.each([
    [{ ...validSettings, maxWaitMs: 9000 }, "a different deadline"],
    [{ ...validSettings, lingmouPollMs: [3000, 5000] }, "a different Lingmou schedule"],
    [{ ...validSettings, emoPollMs: [7000] }, "a different EMO schedule"],
    [{ ...validSettings, primaryProfileId: "" }, "a missing primary profile"],
    [{ ...validSettings, lingmouModelId: "" }, "a missing Lingmou model"],
    [{ ...validSettings, emoModelId: "" }, "a missing EMO model"],
    [
      { ...validSettings, synchronizeProfiles: false, secondaryProfileId: null },
      "a missing secondary profile while synchronization is off"
    ]
  ])("rejects %s", (settings) => {
    expect(() => parseDigitalHumanVideoRuntimeSettings(JSON.stringify(settings))).toThrow();
  });
});

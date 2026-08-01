import type {
  DigitalHumanVideoRuntimeSettings,
  VideoProviderKind
} from "./types";

export function getDueProviders(
  elapsedMs: number,
  settings: DigitalHumanVideoRuntimeSettings
): VideoProviderKind[] {
  const due: VideoProviderKind[] = elapsedMs >= settings.maxWaitMs
    ? ["LINGMOU_BROADCAST", "ALIBABA_EMO"]
    : elapsedMs >= settings.lingmouPollMs[0]
      ? ["LINGMOU_BROADCAST"]
      : [];
  if (settings.mode === "LINGMOU_ONLY") {
    return due.filter((provider) => provider === "LINGMOU_BROADCAST");
  }
  if (settings.mode === "EMO_ONLY") {
    return elapsedMs >= settings.maxWaitMs ? ["ALIBABA_EMO"] : [];
  }
  return due;
}

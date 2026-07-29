export const videoRenderModes = [
  "AUTO_RACE",
  "LINGMOU_ONLY",
  "EMO_ONLY"
] as const;

export type VideoRenderMode = (typeof videoRenderModes)[number];
export type VideoProviderKind = "LINGMOU_BROADCAST" | "ALIBABA_EMO";
export type VideoRenderStatus =
  | "PENDING"
  | "SUBMITTED"
  | "RACING"
  | "READY"
  | "FALLBACK"
  | "FAILED"
  | "EXPIRED";

export interface DigitalHumanVideoRuntimeSettings {
  mode: VideoRenderMode;
  maxWaitMs: 8000;
  lingmouPollMs: readonly [3000, 6000];
  emoPollMs: readonly [8000];
  synchronizeProfiles: boolean;
  primaryProfileId: string;
  secondaryProfileId: string | null;
  lingmouModelId: string;
  emoModelId: string;
}

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

export type VideoProviderTaskStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export interface VideoAssetMetadata {
  contentType: string;
  byteLength: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface VideoSubmitInput {
  requestName: string;
  audioUrl: string;
  portraitUrl: string | null;
  audioMetadata?: VideoAssetMetadata;
  portraitMetadata?: VideoAssetMetadata | null;
}

interface VideoQueryBase {
  traceId: string | null;
  completedAt: Date | null;
}

export type VideoQueryResult =
  | (VideoQueryBase & {
    status: "PENDING" | "RUNNING";
    videoUrl: null;
    safeErrorCode: null;
  })
  | (VideoQueryBase & {
    status: "SUCCEEDED";
    videoUrl: string;
    safeErrorCode: null;
  })
  | (VideoQueryBase & {
    status: "FAILED";
    videoUrl: null;
    safeErrorCode: string;
  });

export interface AsyncAvatarVideoProvider {
  submit(input: VideoSubmitInput): Promise<{
    upstreamTaskId: string;
    traceId: string | null;
  }>;
  query(upstreamTaskId: string): Promise<VideoQueryResult>;
}

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

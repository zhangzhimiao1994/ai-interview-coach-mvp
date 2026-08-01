import type { VideoProviderKind } from "./types";

export type SafeRenderSource = {
  id: string;
  status: string;
  deadlineAt: Date;
  createdAt: Date;
  winnerProvider: VideoProviderKind | null;
  winnerInterviewer: string | null;
  fallbackReason: string | null;
};

const visibleStatuses = new Set(["PENDING", "SUBMITTED", "RACING", "READY", "FALLBACK", "FAILED", "EXPIRED"]);

export function providerDisplayLabel(provider: VideoProviderKind | null) {
  if (provider === "LINGMOU_BROADCAST") return "灵眸播报";
  if (provider === "ALIBABA_EMO") return "阿里云 EMO";
  return null;
}

export function createSafeRenderResponse(source: SafeRenderSource, observedAt = new Date()) {
  const status = visibleStatuses.has(source.status) ? source.status : "PENDING";
  const response: {
    renderId: string;
    status: string;
    deadlineAt: string;
    elapsedMs: number;
    providerLabel: string | null;
    interviewerDisplayName: string | null;
    fallback: { active: boolean; reason: string | null };
    playbackUrl?: string;
  } = {
    renderId: source.id,
    status,
    deadlineAt: source.deadlineAt.toISOString(),
    elapsedMs: Math.max(0, Math.min(86_400_000, observedAt.getTime() - source.createdAt.getTime())),
    providerLabel: providerDisplayLabel(source.winnerProvider),
    interviewerDisplayName: source.winnerInterviewer,
    fallback: {
      active: status === "FALLBACK" || status === "FAILED" || status === "EXPIRED",
      reason: safeCode(source.fallbackReason)
    }
  };
  if (status === "READY") {
    response.playbackUrl = `/api/digital-human/renders/${encodeURIComponent(source.id)}?playback=1`;
  }
  return response;
}

function safeCode(value: string | null) {
  return value && /^[A-Z0-9_]{1,100}$/.test(value) ? value : null;
}

export function parseBoundedRange(value: string | null, byteLength: number, maximumBytes = 8 * 1024 * 1024) {
  if (!value || !Number.isSafeInteger(byteLength) || byteLength <= 0) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : byteLength - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= byteLength || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, byteLength - 1, start + maximumBytes - 1) };
}

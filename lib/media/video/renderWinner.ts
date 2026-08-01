import type { VideoProviderKind } from "./types";

export type VideoRenderWinnerCandidate = {
  attemptId: string;
  providerKind: VideoProviderKind;
  submittedAt: Date;
  completedAt: Date | null;
  successObservedAt: Date;
};

export function chooseVideoRenderWinner(
  candidates: VideoRenderWinnerCandidate[],
  observedAt: Date
): VideoRenderWinnerCandidate | null {
  const ordered = [...candidates].sort((left, right) => {
    const observation = left.successObservedAt.getTime() - right.successObservedAt.getTime();
    if (observation !== 0) return observation;
    const leftCompletion = trustworthyCompletion(left, observedAt);
    const rightCompletion = trustworthyCompletion(right, observedAt);
    if (leftCompletion !== rightCompletion) return leftCompletion - rightCompletion;
    if (left.providerKind === right.providerKind) return 0;
    return left.providerKind === "LINGMOU_BROADCAST" ? -1 : 1;
  });
  return ordered[0] ?? null;
}

function trustworthyCompletion(candidate: VideoRenderWinnerCandidate, observedAt: Date) {
  const value = candidate.completedAt?.getTime();
  if (
    value === undefined || !Number.isFinite(value) ||
    value < candidate.submittedAt.getTime() || value > observedAt.getTime()
  ) return Number.POSITIVE_INFINITY;
  return value;
}

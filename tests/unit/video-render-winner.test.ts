import { describe, expect, it } from "vitest";
import { chooseVideoRenderWinner } from "@/lib/media/video/renderOrchestrator";

const submittedAt = new Date("2026-08-01T00:00:00.000Z");
const observedAt = new Date("2026-08-01T00:00:05.000Z");

describe("video render winner selection", () => {
  it("prefers an earlier trustworthy completion observed in the same advancement", () => {
    expect(chooseVideoRenderWinner([
      candidate("LINGMOU_BROADCAST", "2026-08-01T00:00:04.500Z"),
      candidate("ALIBABA_EMO", "2026-08-01T00:00:04.000Z")
    ], observedAt)?.providerKind).toBe("ALIBABA_EMO");
  });

  it("prefers Lingmou when completions are equal or untrusted", () => {
    expect(chooseVideoRenderWinner([
      candidate("ALIBABA_EMO", "2026-08-01T00:00:04.000Z"),
      candidate("LINGMOU_BROADCAST", "2026-08-01T00:00:04.000Z")
    ], observedAt)?.providerKind).toBe("LINGMOU_BROADCAST");

    expect(chooseVideoRenderWinner([
      candidate("ALIBABA_EMO", "2026-08-01T00:00:08.000Z"),
      candidate("LINGMOU_BROADCAST", null)
    ], observedAt)?.providerKind).toBe("LINGMOU_BROADCAST");
  });

  it("never lets a later observation steal the winner with an earlier provider timestamp", () => {
    expect(chooseVideoRenderWinner([
      candidate("LINGMOU_BROADCAST", null),
      {
        ...candidate("ALIBABA_EMO", "2026-08-01T00:00:01.000Z"),
        successObservedAt: new Date("2026-08-01T00:00:06.000Z")
      }
    ], new Date("2026-08-01T00:00:06.000Z"))?.providerKind).toBe("LINGMOU_BROADCAST");
  });
});

function candidate(providerKind: "LINGMOU_BROADCAST" | "ALIBABA_EMO", completedAt: string | null) {
  return {
    attemptId: providerKind,
    providerKind,
    submittedAt,
    completedAt: completedAt ? new Date(completedAt) : null,
    successObservedAt: observedAt
  };
}

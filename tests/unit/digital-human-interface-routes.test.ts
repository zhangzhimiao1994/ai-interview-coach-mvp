import { describe, expect, it, vi } from "vitest";

describe("digital human provider-ready API routes", () => {
  it("disables the legacy paid TTS path before validation or provider work", async () => {
    const route = await import("@/lib/media/digitalHumanSpeech");
    const findSession = vi.fn();
    const resolveModel = vi.fn();
    const synthesize = vi.fn();
    const logCall = vi.fn();
    const handler = route.createDigitalHumanSpeechHandler({
      findSession,
      consumeRateLimit: vi.fn(),
      resolveModel,
      synthesize,
      logCall
    });

    const response = await handler(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({
          text: "任意付费朗读文本",
          sessionId: "training-1"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toEqual({
      mode: "BROWSER_TTS_FALLBACK",
      reasonCode: "DIGITAL_HUMAN_SESSION_REQUIRED"
    });
    expect(findSession).not.toHaveBeenCalled();
    expect(resolveModel).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(logCall).not.toHaveBeenCalled();
  });

  it("returns a client-render fallback contract from the digital human render interface", async () => {
    const route = await import("@/app/api/digital-human/render/route");
    const response = await route.POST(
      new Request("http://localhost/api/digital-human/render", {
        method: "POST",
        body: JSON.stringify({
          text: "你刚才提到增长指标，请补充具体数字。",
          avatarId: "interviewer-default",
          expression: "probing"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("CLIENT_RENDER_FALLBACK");
    expect(payload.providerCapability).toBe("DIGITAL_HUMAN_VIDEO");
    expect(payload.render.expression).toBe("probing");
  });

  it("summarizes observable behavior signals through the behavior-analysis interface", async () => {
    const route = await import("@/app/api/behavior-analysis/route");
    const response = await route.POST(
      new Request("http://localhost/api/behavior-analysis", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          questionId: "FORMAL_INTERVIEW-1",
          signals: {
            answerDurationSeconds: 95,
            transcriptLength: 80,
            averageVolume: 42,
            peakVolume: 78,
            longPauseCount: 2,
            cameraEnabled: true,
            microphoneEnabled: true,
            speechRecognitionUsed: true
          }
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("LOCAL_SIGNAL_SUMMARY");
    expect(payload.providerCapability).toBe("VISION_BEHAVIOR_ANALYSIS");
    expect(payload.summary.observations.join(" ")).toContain("长停顿");
  });
});

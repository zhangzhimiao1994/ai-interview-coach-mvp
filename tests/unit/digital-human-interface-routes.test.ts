import { describe, expect, it } from "vitest";

describe("digital human provider-ready API routes", () => {
  it("returns browser TTS fallback instructions from the speech interface", async () => {
    const route = await import("@/app/api/digital-human/speech/route");
    const response = await route.POST(
      new Request("http://localhost/api/digital-human/speech", {
        method: "POST",
        body: JSON.stringify({
          text: "请先做一个一分钟自我介绍。",
          voice: "professional-female",
          language: "zh-CN"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("BROWSER_TTS_FALLBACK");
    expect(payload.providerCapability).toBe("TEXT_TO_SPEECH");
    expect(payload.speech.text).toContain("自我介绍");
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

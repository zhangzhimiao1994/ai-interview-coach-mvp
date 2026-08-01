import { describe, expect, it } from "vitest";
import { createFallbackSpeechHandler } from "@/app/api/digital-human/fallback-speech/handler";

describe("candidate Qwen fallback speech route", () => {
  it("requires candidate ownership and exact persisted question text", async () => {
    let streams = 0;
    const handler = createFallbackSpeechHandler({
      authenticate: async () => ({ type: "candidate", trainingSessionId: "session-1", candidateId: "candidate-1" }),
      findTrainingSession: async () => ({ id: "session-1", candidateId: "candidate-1", status: "IN_PROGRESS", outlineJson: JSON.stringify({ questions: [{ id: "q1", stage: "FORMAL_INTERVIEW", prompt: "Exact question", followUps: [] }] }), turns: [] }),
      resolveModel: async () => ({ providerId: "p", providerName: "Bailian", providerType: "TONGYI", providerConfigVersion: 1, capability: "TEXT_TO_SPEECH", modelId: "m", modelDisplayName: "Qwen TTS", modelName: "qwen-audio-3.0-tts-flash", baseUrl: null, providerSettings: {}, modelSettings: {}, temperature: 0.2, maxTokens: 1000, timeoutMs: 30000, credentialEnvelopes: { apiKey: null, structured: null } }),
      streamPcm: async () => { streams += 1; return { provider: "Bailian", model: "qwen-audio-3.0-tts-flash", mode: "stream", traceId: "trace-1", fallbackUsed: false, encoding: "pcm_s16le", sampleRate: 48000, channels: 1, chunks: { async *[Symbol.asyncIterator]() { yield Uint8Array.from([1, 0]); } } }; },
      logCall: async () => undefined,
      consumeRateLimit: () => ({ allowed: true }),
      now: () => 1
    });
    const mismatch = await handler(request({ sessionId: "session-1", questionId: "q1", text: "Changed question" }));
    expect(mismatch.status).toBe(400); expect(streams).toBe(0);
    const response = await handler(request({ sessionId: "session-1", questionId: "q1", text: "Exact question" }));
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 0]);
    expect(streams).toBe(1);
  });

  it("denies a candidate capability for a different training session", async () => {
    const handler = createFallbackSpeechHandler({ authenticate: async () => ({ type: "candidate", trainingSessionId: "other", candidateId: "candidate-1" }) });
    expect((await handler(request({ sessionId: "session-1", questionId: "q1", text: "Exact question" }))).status).toBe(403);
  });
});

function request(body: unknown) { return new Request("http://localhost/api/digital-human/fallback-speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

import { describe, expect, it } from "vitest";
import { createFallbackSpeechHandler } from "@/app/api/digital-human/fallback-speech/handler";

describe("candidate Qwen fallback speech route", () => {
  it("requires candidate ownership and exact persisted question text", async () => {
    let streams = 0;
    const handler = createFallbackSpeechHandler({
      authenticate: async () => ({ type: "candidate", trainingSessionId: "session-1", candidateId: "candidate-1" }),
      findSpeechContext: async () => speechContext(),
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

  it("reuses the exact placeholder behavior signals and runtime-bound profile style", async () => {
    const inputs: unknown[] = [];
    const handler = createFallbackSpeechHandler({
      authenticate: async () => ({ type: "candidate", trainingSessionId: "session-1", candidateId: "candidate-1" }),
      findSpeechContext: async () => speechContext({ question: { id: "q1", stage: "FORMAL_INTERVIEW", text: "Why did this fail?", behaviorSignals: { hesitation: 0.91 } }, profile: { id: "profile-1", voice: "default_voice", enabled: true, styleJson: JSON.stringify({ signalVoices: { HESITATION: "patient_voice" }, intentVoices: { PRESSURE: "strict_voice" }, speed: 0.82 }) } }),
      resolveModel: async () => model(),
      streamPcm: async (input) => { inputs.push(input); return pcm(); },
      logCall: async () => undefined,
      consumeRateLimit: () => ({ allowed: true }),
      now: () => 1
    });
    const response = await handler(request({ sessionId: "session-1", questionId: "q1", text: "Why did this fail?" }));
    await response.arrayBuffer();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ voice: "patient_voice", speed: 0.82 });
    expect((inputs[0] as { instructions: string }).instructions).toContain("hesitant");
  });

  it("returns the provider iterator when stream reading fails", async () => {
    let returned = 0;
    const chunks = { [Symbol.asyncIterator]() { return { next: async () => { throw new Error("stream failed"); }, return: async () => { returned += 1; return { done: true, value: undefined }; } }; } };
    const handler = createFallbackSpeechHandler({
      authenticate: async () => ({ type: "candidate", trainingSessionId: "session-1", candidateId: "candidate-1" }),
      findSpeechContext: async () => speechContext({ question: { id: "q1", stage: "FORMAL_INTERVIEW", text: "Why did this fail?", behaviorSignals: null } }), resolveModel: async () => model(),
      streamPcm: async () => ({ ...pcm(), chunks }), logCall: async () => undefined,
      consumeRateLimit: () => ({ allowed: true }), now: () => 1
    });
    const response = await handler(request({ sessionId: "session-1", questionId: "q1", text: "Why did this fail?" }));
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(returned).toBe(1);
  });

  it("denies a candidate capability for a different training session", async () => {
    const handler = createFallbackSpeechHandler({ authenticate: async () => ({ type: "candidate", trainingSessionId: "other", candidateId: "candidate-1" }) });
    expect((await handler(request({ sessionId: "session-1", questionId: "q1", text: "Exact question" }))).status).toBe(403);
  });
});

function request(body: unknown) { return new Request("http://localhost/api/digital-human/fallback-speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function speechContext(overrides: Record<string, unknown> = {}) { return { session: { id: "session-1", candidateId: "candidate-1", status: "IN_PROGRESS" }, question: { id: "q1", stage: "FORMAL_INTERVIEW", text: "Exact question", behaviorSignals: null }, profile: { id: "profile-1", voice: "default_voice", styleJson: "{}", enabled: true }, ...overrides }; }
function model() { return { providerId: "p", providerName: "Bailian", providerType: "TONGYI", providerConfigVersion: 1, capability: "TEXT_TO_SPEECH" as const, modelId: "m", modelDisplayName: "Qwen TTS", modelName: "qwen-audio-3.0-tts-flash", baseUrl: null, providerSettings: {}, modelSettings: {}, temperature: 0.2, maxTokens: 1000, timeoutMs: 30000, credentialEnvelopes: { apiKey: null, structured: null } }; }
function pcm() { return { provider: "Bailian", model: "qwen-audio-3.0-tts-flash", mode: "stream", traceId: "trace-1", fallbackUsed: false, encoding: "pcm_s16le" as const, sampleRate: 48000 as const, channels: 1 as const, chunks: { async *[Symbol.asyncIterator]() { yield Uint8Array.from([1, 0]); } } }; }

import { describe, expect, it } from "vitest";
import {
  prewarmRenderQuestionsWithRetry,
  requestDynamicRender
} from "@/lib/client/digitalHumanRenderRequests";

describe("digital human render client requests", () => {
  it("retries a transient prewarm failure and marks success only after acceptance", async () => {
    let calls = 0;
    const accepted = await prewarmRenderQuestionsWithRetry({
      sessionId: "session-a",
      currentQuestionId: "question-a",
      retryDelayMs: 0,
      fetcher: async () => new Response(null, { status: ++calls === 1 ? 503 : 202 })
    });
    expect(accepted).toBe(true);
    expect(calls).toBe(2);
  });

  it("lets StrictMode cleanup abort one request and a replay refetch successfully", async () => {
    const firstController = new AbortController();
    const first = prewarmRenderQuestionsWithRetry({
      sessionId: "session-a",
      currentQuestionId: "question-a",
      signal: firstController.signal,
      fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })
    });
    firstController.abort();
    await expect(first).resolves.toBe(false);

    let replayCalls = 0;
    await expect(prewarmRenderQuestionsWithRetry({
      sessionId: "session-a",
      currentQuestionId: "question-a",
      fetcher: async () => {
        replayCalls += 1;
        return new Response(null, { status: 202 });
      }
    })).resolves.toBe(true);
    expect(replayCalls).toBe(1);
  });

  it("bounds a background dynamic-render request and absorbs timeout failure", async () => {
    let aborted = false;
    await expect(requestDynamicRender({
      sessionId: "session-a",
      questionId: "question-a::follow-up::1",
      timeoutMs: 10,
      fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      })
    })).resolves.toBe(false);
    expect(aborted).toBe(true);
  });
});

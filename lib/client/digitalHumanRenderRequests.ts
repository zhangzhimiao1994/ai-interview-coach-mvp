type PrewarmRenderQuestionsInput = {
  sessionId: string;
  currentQuestionId: string;
  signal?: AbortSignal;
  retryDelayMs?: number;
  maxAttempts?: number;
  fetcher?: typeof fetch;
};

export async function prewarmRenderQuestionsWithRetry(input: PrewarmRenderQuestionsInput) {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.signal?.aborted) return false;
    try {
      const response = await (input.fetcher ?? fetch)("/api/digital-human/renders/prewarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          currentQuestionId: input.currentQuestionId
        }),
        signal: input.signal
      });
      if (response.ok) return true;
      if (!isTransientStatus(response.status)) return false;
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) return false;
    }
    if (attempt < maxAttempts && !await waitForRetry(input.retryDelayMs ?? 250, input.signal)) {
      return false;
    }
  }
  return false;
}

type DynamicRenderInput = {
  sessionId: string;
  questionId: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

export async function requestDynamicRender(input: DynamicRenderInput) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Dynamic render request timeout"));
      }, input.timeoutMs ?? 5_000);
    });
    const response = await Promise.race([
      (input.fetcher ?? fetch)("/api/digital-human/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          questionId: input.questionId,
          kind: "DYNAMIC"
        }),
        signal: controller.signal
      }),
      timeoutFailure
    ]);
    return response.ok;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(true);
    }, Math.max(0, delayMs));
    function abort() {
      clearTimeout(timeout);
      resolve(false);
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

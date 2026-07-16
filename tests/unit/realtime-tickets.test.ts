import { describe, expect, it } from "vitest";
import { createRealtimeTicketStore } from "@/lib/realtime/tickets";

describe("realtime ASR tickets", () => {
  it("consumes a ticket once", () => {
    const store = createRealtimeTicketStore(() => 1_000);
    const ticket = store.issue(
      { sessionId: "session-1", modelId: "model-1" },
      60_000
    );

    expect(store.consume(ticket)).toMatchObject({
      sessionId: "session-1",
      modelId: "model-1"
    });
    expect(store.consume(ticket)).toBeNull();
  });

  it("rejects expired tickets and removes them from the store", () => {
    const store = createRealtimeTicketStore(() => 1_000);
    const ticket = store.issue(
      { sessionId: "session-2", modelId: "model-2" },
      1
    );

    expect(store.consume(ticket, 1_002)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("prunes expired tickets before issuing another ticket", () => {
    let currentTime = 1_000;
    const store = createRealtimeTicketStore(() => currentTime);

    store.issue({ sessionId: "expired", modelId: "model-1" }, 1);
    currentTime = 1_002;
    store.issue({ sessionId: "active", modelId: "model-2" }, 60_000);

    expect(store.size()).toBe(1);
  });
});

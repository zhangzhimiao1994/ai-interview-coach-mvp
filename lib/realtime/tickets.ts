import { randomBytes } from "node:crypto";

export type RealtimeTicketPayload = {
  sessionId: string;
  modelId: string;
};

type StoredRealtimeTicket = RealtimeTicketPayload & {
  expiresAt: number;
};

export type RealtimeTicketStore = ReturnType<typeof createRealtimeTicketStore>;

export function createRealtimeTicketStore(now = Date.now) {
  const tickets = new Map<string, StoredRealtimeTicket>();

  function prune(currentTime: number) {
    for (const [ticket, value] of tickets) {
      if (value.expiresAt <= currentTime) {
        tickets.delete(ticket);
      }
    }
  }

  return {
    issue(payload: RealtimeTicketPayload, ttlMs: number) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new RangeError("Realtime ticket TTL must be a positive number");
      }

      const currentTime = now();
      prune(currentTime);

      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, {
        ...payload,
        expiresAt: currentTime + ttlMs
      });

      return ticket;
    },

    consume(ticket: string, currentTime = now()) {
      const value = tickets.get(ticket);
      tickets.delete(ticket);

      if (!value || value.expiresAt <= currentTime) {
        return null;
      }

      return value;
    },

    size() {
      return tickets.size;
    }
  };
}

const globalTicketStore = globalThis as typeof globalThis & {
  __aiInterviewRealtimeTicketStore?: RealtimeTicketStore;
};

export const realtimeTicketStore =
  globalTicketStore.__aiInterviewRealtimeTicketStore ??
  (globalTicketStore.__aiInterviewRealtimeTicketStore = createRealtimeTicketStore());

import { describe, expect, it } from "vitest";
import {
  createDigitalHumanVideoDiagnosticsHandler
} from "@/app/api/ai-services/digital-human-video-diagnostics/handler";

describe("digital human video diagnostics route", () => {
  it("rejects unauthenticated and non-admin requests before the service", async () => {
    for (const actor of [null, { id: "candidate-1", role: "CANDIDATE" }]) {
      let serviceCalls = 0;
      const handler = createDigitalHumanVideoDiagnosticsHandler({
        authorizeAdmin: async () => actor,
        runDiagnostic: async () => {
          serviceCalls += 1;
          return diagnostic();
        }
      });

      const response = await handler(request(validBody()));

      expect(response.status).toBe(actor ? 403 : 401);
      expect(serviceCalls).toBe(0);
    }
  });

  it("rejects invalid CSRF origin before the service", async () => {
    let serviceCalls = 0;
    const handler = createDigitalHumanVideoDiagnosticsHandler({
      authorizeAdmin: async () => ({ id: "admin-1", role: "ADMIN" }),
      runDiagnostic: async () => {
        serviceCalls += 1;
        return diagnostic();
      }
    });

    const response = await handler(request(validBody(), "https://evil.example"));

    expect(response.status).toBe(403);
    expect(serviceCalls).toBe(0);
  });

  it.each([
    ["malformed JSON", "{"],
    ["unsupported provider", JSON.stringify({ mode: "PAID", providerKind: "UNKNOWN", confirmPaidRequest: true })],
    ["missing paid confirmation", JSON.stringify({ mode: "PAID", providerKind: "ALIBABA_EMO" })],
    ["false paid confirmation", JSON.stringify({ mode: "PAID", providerKind: "ALIBABA_EMO", confirmPaidRequest: false })]
  ])("fails closed for %s", async (_name, body) => {
    let serviceCalls = 0;
    const handler = createDigitalHumanVideoDiagnosticsHandler({
      authorizeAdmin: async () => ({ id: "admin-1", role: "SUPER_ADMIN" }),
      runDiagnostic: async () => {
        serviceCalls += 1;
        return diagnostic();
      }
    });

    const response = await handler(request(body));

    expect(response.status).toBe(400);
    expect(serviceCalls).toBe(0);
  });

  it("passes only a validated request and actor ID to the diagnostic service", async () => {
    const observed: unknown[] = [];
    const handler = createDigitalHumanVideoDiagnosticsHandler({
      authorizeAdmin: async () => ({ id: "admin-1", role: "ADMIN" }),
      runDiagnostic: async (input, actorId) => {
        observed.push(input, actorId);
        return diagnostic({ providerKind: "ALIBABA_EMO", traceId: "trace-safe" });
      }
    });

    const response = await handler(request(validBody("ALIBABA_EMO")));

    expect(response.status).toBe(200);
    expect(observed).toEqual([{
      mode: "PAID",
      providerKind: "ALIBABA_EMO",
      confirmPaidRequest: true
    }, "admin-1"]);
  });

  it("strictly whitelists the route response even when a service boundary adds secrets", async () => {
    const secret = "sk-route-secret";
    const signedUrl = "https://signed.example/private.wav?token=secret";
    const handler = createDigitalHumanVideoDiagnosticsHandler({
      authorizeAdmin: async () => ({ id: "admin-1", role: "ADMIN" }),
      runDiagnostic: async () => ({
        ...diagnostic({ status: "PROVIDER_ERROR", code: "ALIBABA_EMO_UPSTREAM_FAILED" }),
        apiKey: secret,
        signedUrl,
        rawBody: { message: secret }
      }) as never
    });

    const response = await handler(request(validBody()));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ diagnostic: diagnostic({
      status: "PROVIDER_ERROR",
      code: "ALIBABA_EMO_UPSTREAM_FAILED"
    }) });
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(JSON.stringify(payload)).not.toContain(signedUrl);
  });
});

function diagnostic(overrides: Record<string, unknown> = {}) {
  return {
    status: "REACHABLE",
    code: "REACHABLE",
    providerKind: "LINGMOU_BROADCAST",
    traceId: null,
    checkedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function validBody(providerKind = "LINGMOU_BROADCAST") {
  return JSON.stringify({
    mode: "PAID",
    providerKind,
    confirmPaidRequest: true
  });
}

function request(body: string, origin = "http://localhost") {
  return new Request("http://localhost/api/ai-services/digital-human-video-diagnostics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin
    },
    body
  });
}

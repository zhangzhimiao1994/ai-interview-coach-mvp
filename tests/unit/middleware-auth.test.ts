import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { candidateSessionCookieName, createCandidateSessionCookie } from "@/lib/security/candidateSession";

function configureProductionAuth(username = "", password = "") {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AI_CONFIG_SECRET", "");
  vi.stubEnv("ADMIN_USERNAME", username);
  vi.stubEnv("ADMIN_PASSWORD", password);
}

describe("middleware admin authentication fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses database login as the production default when Basic Auth is omitted", async () => {
    configureProductionAuth();

    const pageResponse = await middleware(new NextRequest("https://coach.example/admin"));
    const apiResponse = await middleware(new NextRequest("https://coach.example/api/admin/users"));

    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe("https://coach.example/login?next=%2Fadmin");
    expect(apiResponse.status).toBe(401);
  });

  it("accepts a configured strong Basic Auth pair as an emergency fallback", async () => {
    configureProductionAuth("operator", "strong-fallback-password");
    const authorization = `Basic ${Buffer.from("operator:strong-fallback-password").toString("base64")}`;

    const response = await middleware(
      new NextRequest("https://coach.example/admin", {
        headers: { authorization }
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed when only half of the emergency pair is configured", async () => {
    configureProductionAuth("operator", "");

    const response = await middleware(new NextRequest("https://coach.example/admin"));

    expect(response.status).toBe(503);
  });

  describe("candidate interview room requests", () => {
    const secret = "candidate-room-test-secret-0123456789abcdef";

    async function candidateCookie() {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AI_CONFIG_SECRET", secret);
      vi.stubEnv("ADMIN_USERNAME", "");
      vi.stubEnv("ADMIN_PASSWORD", "");
      const value = await createCandidateSessionCookie({ trainingSessionId: "session-1", candidateId: "candidate-1" }, secret);
      return `${candidateSessionCookieName}=${value}`;
    }

    it("lets the room request fallback speech and speech recognition tickets", async () => {
      const cookie = await candidateCookie();

      for (const path of ["/api/digital-human/fallback-speech", "/api/speech-recognition/sessions"]) {
        const response = await middleware(new NextRequest(`https://coach.example${path}`, { method: "POST", headers: { cookie } }));
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
    });

    it("never sends a Basic challenge that would open a browser login dialog over the room", async () => {
      const cookie = await candidateCookie();

      const response = await middleware(new NextRequest("https://coach.example/api/admin/users", { headers: { cookie } }));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBeNull();
    });
  });
});

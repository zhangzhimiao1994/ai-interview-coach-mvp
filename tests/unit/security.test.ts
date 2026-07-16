import { describe, expect, it } from "vitest";
import {
  authenticateBasicRequest,
  consumeRateLimit,
  isProtectedPath,
  pruneExpiredRateLimits,
  resetRateLimits
} from "@/lib/security/requestGuards";

describe("request security guards", () => {
  it("protects admin, practice, and API paths", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/admin/ai-services")).toBe(true);
    expect(isProtectedPath("/practice/task-1/room")).toBe(true);
    expect(isProtectedPath("/api/sessions")).toBe(true);
    expect(isProtectedPath("/api/health")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/_next/static/chunk.js")).toBe(false);
  });

  it("authenticates matching Basic Auth credentials", () => {
    const encoded = Buffer.from("admin:secret-password").toString("base64");

    expect(
      authenticateBasicRequest(`Basic ${encoded}`, {
        username: "admin",
        password: "secret-password"
      }).ok
    ).toBe(true);
    expect(
      authenticateBasicRequest(`Basic ${encoded}`, {
        username: "admin",
        password: "wrong-password"
      }).ok
    ).toBe(false);
  });

  it("rate limits repeated session creation attempts", () => {
    resetRateLimits();

    for (let index = 0; index < 10; index += 1) {
      expect(consumeRateLimit("POST:/api/sessions:127.0.0.1", 10, 60_000).allowed).toBe(true);
    }

    expect(consumeRateLimit("POST:/api/sessions:127.0.0.1", 10, 60_000).allowed).toBe(false);
  });

  it("removes expired rate-limit buckets", () => {
    resetRateLimits();
    consumeRateLimit("expired", 1, 1_000, 1_000);
    consumeRateLimit("active", 1, 1_000, 2_500);

    expect(pruneExpiredRateLimits(2_600)).toBe(1);
    expect(consumeRateLimit("active", 1, 1_000, 2_600).allowed).toBe(false);
  });

});

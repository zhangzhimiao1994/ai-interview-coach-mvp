import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  authenticateBasicRequest,
  consumeRateLimit,
  isProtectedPath,
  isCandidateApiPath,
  isCandidateEntryPath,
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

  it("exposes only candidate entry and capability-scoped API paths", () => {
    expect(isCandidateEntryPath("/practice/task-1", "GET")).toBe(true);
    expect(isCandidateEntryPath("/api/sessions", "POST")).toBe(true);
    expect(isCandidateEntryPath("/api/sessions", "GET")).toBe(false);
    expect(isCandidateApiPath("/api/sessions/session-1/answer", "session-1")).toBe(true);
    expect(isCandidateApiPath("/api/sessions/session-2/answer", "session-1")).toBe(false);
    expect(isCandidateApiPath("/api/digital-human/renders/render-1", "session-1")).toBe(true);
    expect(isCandidateApiPath("/api/admin/users", "session-1")).toBe(false);
    expect(isCandidateApiPath("/api/ai-services/providers", "session-1")).toBe(false);
    expect(isCandidateApiPath("/api/digital-human/sessions/private", "session-1")).toBe(false);
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

  it("keeps recruitment documentation examples free of real secrets and session JSON", () => {
    const root = process.cwd();
    const deploymentDocs = readFileSync(join(root, "docs/linux-deployment.md"), "utf8");
    const handoff = readFileSync(join(root, "docs/new-project-handoff-2026-07-16.md"), "utf8");
    const combined = `${deploymentDocs}\n${handoff}`;

    expect(combined).toContain("RECRUITMENT_SESSION_SECRET");
    expect(combined).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(combined).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(combined).not.toContain('"cookies":[{"name":"sid","value"');
    expect(combined).not.toContain("secret-cookie");
  });

});

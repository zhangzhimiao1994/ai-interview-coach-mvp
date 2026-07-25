import { describe, expect, it } from "vitest";
import {
  createAdminSessionCookie,
  verifyAdminSessionCookie
} from "@/lib/security/adminSession";

describe("admin auth session cookies", () => {
  it("accepts a signed unexpired admin session and rejects tampering", async () => {
    const cookie = await createAdminSessionCookie(
      { subject: "admin-user-1", username: "alice", source: "database" },
      "session-signing-secret",
      1_000,
      1_700_000_000_000
    );

    await expect(
      verifyAdminSessionCookie(cookie, "session-signing-secret", 1_700_000_000_500)
    ).resolves.toMatchObject({
      ok: true,
      session: {
        subject: "admin-user-1",
        username: "alice",
        source: "database"
      }
    });

    await expect(
      verifyAdminSessionCookie(`${cookie.slice(0, -1)}x`, "session-signing-secret", 1_700_000_000_500)
    ).resolves.toEqual({ ok: false });
  });

  it("rejects an expired admin session", async () => {
    const cookie = await createAdminSessionCookie(
      { subject: "admin-user-1", username: "alice", source: "database" },
      "session-signing-secret",
      1_000,
      1_700_000_000_000
    );

    await expect(
      verifyAdminSessionCookie(cookie, "session-signing-secret", 1_700_000_001_001)
    ).resolves.toEqual({ ok: false });
  });
});

import { describe, expect, it } from "vitest";
import {
  authenticateAdminUser,
  hashAdminPassword,
  serializeAdminUser,
  verifyAdminPassword
} from "@/lib/admin/adminUsers";

describe("admin users", () => {
  it("hashes passwords with salt and verifies only the original password", async () => {
    const hash = await hashAdminPassword("correct-horse-battery-staple", "fixed-salt-for-test");

    expect(hash).toMatch(/^scrypt\$/);
    await expect(verifyAdminPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("authenticates enabled users and rejects disabled users", async () => {
    const enabledHash = await hashAdminPassword("enabled-password", "enabled-salt");
    const disabledHash = await hashAdminPassword("disabled-password", "disabled-salt");
    const users = new Map([
      ["enabled", {
        id: "user-enabled",
        username: "enabled",
        displayName: "Enabled User",
        passwordHash: enabledHash,
        role: "ADMIN",
        enabled: true,
        lastLoginAt: null,
        createdAt: new Date("2026-07-25T00:00:00.000Z"),
        updatedAt: new Date("2026-07-25T00:00:00.000Z")
      }],
      ["disabled", {
        id: "user-disabled",
        username: "disabled",
        displayName: "Disabled User",
        passwordHash: disabledHash,
        role: "ADMIN",
        enabled: false,
        lastLoginAt: null,
        createdAt: new Date("2026-07-25T00:00:00.000Z"),
        updatedAt: new Date("2026-07-25T00:00:00.000Z")
      }]
    ]);
    const prisma = {
      adminUser: {
        findUnique: async ({ where }: { where: { username: string } }) =>
          users.get(where.username) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: { lastLoginAt: Date } }) => ({
          ...[...users.values()].find((user) => user.id === where.id)!,
          lastLoginAt: data.lastLoginAt
        })
      }
    };

    await expect(
      authenticateAdminUser(prisma, "enabled", "enabled-password")
    ).resolves.toMatchObject({
      ok: true,
      user: { id: "user-enabled", username: "enabled" }
    });
    await expect(
      authenticateAdminUser(prisma, "disabled", "disabled-password")
    ).resolves.toEqual({ ok: false, reason: "DISABLED" });
  });

  it("serializes admin users without leaking password hashes", async () => {
    expect(serializeAdminUser({
      id: "user-1",
      username: "alice",
      displayName: "Alice",
      passwordHash: "scrypt$secret",
      role: "ADMIN",
      enabled: true,
      lastLoginAt: null,
      createdAt: new Date("2026-07-25T00:00:00.000Z"),
      updatedAt: new Date("2026-07-25T00:00:00.000Z")
    })).toEqual({
      id: "user-1",
      username: "alice",
      displayName: "Alice",
      role: "ADMIN",
      enabled: true,
      lastLoginAt: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z"
    });
  });
});

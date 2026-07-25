import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("admin user management routes", () => {
  it("lists admin users without leaking password hashes", async () => {
    const prisma = {
      adminUser: {
        findMany: vi.fn().mockResolvedValue([{
          id: "user-1",
          username: "alice",
          displayName: "Alice",
          passwordHash: "scrypt$secret",
          role: "ADMIN",
          enabled: true,
          lastLoginAt: null,
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          updatedAt: new Date("2026-07-25T00:00:00.000Z")
        }])
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/admin/users/route");
    const response = await route.GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.users).toEqual([expect.objectContaining({
      id: "user-1",
      username: "alice",
      enabled: true
    })]);
    expect(JSON.stringify(payload)).not.toContain("scrypt$secret");
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
  });

  it("creates enabled admin users with hashed passwords", async () => {
    const prisma = {
      adminUser: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "user-2",
          username: data.username,
          displayName: data.displayName,
          passwordHash: data.passwordHash,
          role: data.role,
          enabled: data.enabled,
          lastLoginAt: null,
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          updatedAt: new Date("2026-07-25T00:00:00.000Z")
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/admin/users/route");
    const response = await route.POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "bob",
        displayName: "Bob",
        password: "bob-admin-password",
        role: "ADMIN"
      })
    }));
    const payload = await response.json();
    const createData = prisma.adminUser.create.mock.calls[0][0].data;

    expect(response.status).toBe(201);
    expect(createData.passwordHash).toMatch(/^scrypt\$/);
    expect(createData.passwordHash).not.toContain("bob-admin-password");
    expect(createData.enabled).toBe(true);
    expect(payload.user).toMatchObject({ username: "bob", enabled: true });
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
  });

  it("updates enabled state without changing password hash", async () => {
    const prisma = {
      adminUser: {
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "user-2",
          username: "bob",
          displayName: "Bob",
          passwordHash: "scrypt$secret",
          role: "ADMIN",
          enabled: data.enabled,
          lastLoginAt: null,
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          updatedAt: new Date("2026-07-25T00:00:00.000Z")
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/admin/users/[userId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/admin/users/user-2", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.adminUser.update.mock.calls[0][0].data).toEqual({ enabled: false });
    expect(payload.user).toMatchObject({ username: "bob", enabled: false });
    expect(JSON.stringify(payload)).not.toContain("scrypt$secret");
  });
});

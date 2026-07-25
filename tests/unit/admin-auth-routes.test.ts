import { afterEach, describe, expect, it, vi } from "vitest";
import { hashAdminPassword } from "@/lib/admin/adminUsers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("admin auth routes", () => {
  it("initializes the first super admin only when no admin users exist", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-session-secret");
    const prisma = {
      adminUser: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "root-user",
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

    const route = await import("@/app/api/auth/setup/route");
    const response = await route.POST(new Request("http://localhost/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "root",
        displayName: "Root Admin",
        password: "first-admin-password"
      })
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.user).toMatchObject({
      username: "root",
      displayName: "Root Admin",
      role: "SUPER_ADMIN",
      enabled: true
    });
    expect(JSON.stringify(payload)).not.toContain("first-admin-password");
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
    expect(response.headers.get("set-cookie")).toContain("aic_admin_session=");
  });

  it("rejects setup after an admin user already exists", async () => {
    const prisma = {
      adminUser: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn()
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/auth/setup/route");
    const response = await route.POST(new Request("http://localhost/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "root",
        password: "first-admin-password"
      })
    }));

    expect(response.status).toBe(409);
    expect(prisma.adminUser.create).not.toHaveBeenCalled();
  });

  it("logs in an enabled database user and sets an admin session cookie", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-session-secret");
    const passwordHash = await hashAdminPassword("admin-password", "route-salt");
    const prisma = {
      adminUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          username: "alice",
          displayName: "Alice",
          passwordHash,
          role: "ADMIN",
          enabled: true,
          lastLoginAt: null,
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          updatedAt: new Date("2026-07-25T00:00:00.000Z")
        }),
        update: vi.fn().mockResolvedValue({})
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/auth/login/route");
    const response = await route.POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "admin-password" })
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user).toMatchObject({ username: "alice", source: "database" });
    expect(response.headers.get("set-cookie")).toContain("aic_admin_session=");
  });

  it("rejects a disabled database user without setting a session cookie", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-session-secret");
    const passwordHash = await hashAdminPassword("admin-password", "route-salt");
    const prisma = {
      adminUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          username: "alice",
          displayName: "Alice",
          passwordHash,
          role: "ADMIN",
          enabled: false,
          lastLoginAt: null,
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          updatedAt: new Date("2026-07-25T00:00:00.000Z")
        }),
        update: vi.fn()
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/auth/login/route");
    const response = await route.POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "admin-password" })
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ error: "Login disabled" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw
  }
}));

describe("health route", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns ready when the application can reach the database", async () => {
    queryRaw.mockResolvedValue([{ ok: 1 }]);
    const { GET } = await import("@/app/api/health/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks.database).toBe("up");
  });

  it("returns unavailable when the database check fails", async () => {
    queryRaw.mockRejectedValue(new Error("database unavailable"));
    const { GET } = await import("@/app/api/health/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    expect(body.checks.database).toBe("down");
  });
});

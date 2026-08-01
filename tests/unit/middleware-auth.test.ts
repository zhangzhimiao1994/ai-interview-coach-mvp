import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

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
});

import { afterEach, describe, expect, it, vi } from "vitest";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/recruitment/sources/source-1/authorization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("recruitment browser session authorization route", () => {
  it("stores encrypted browser storage-state JSON and returns only a preview", async () => {
    vi.stubEnv("RECRUITMENT_SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    const prisma = {
      recruitmentSource: {
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "source-1",
          provider: "linkedin",
          sourceType: "AUTHORIZED_BROWSER",
          displayName: "LinkedIn authorized",
          enabled: true,
          credentialPreview: null,
          sessionPreview: data.sessionPreview,
          verificationStatus: data.verificationStatus,
          lastVerifiedAt: data.lastVerifiedAt,
          lastSuccessfulSyncAt: null,
          settingsJson: "{}",
          createdAt: new Date("2026-07-27T00:00:00.000Z"),
          updatedAt: new Date("2026-07-27T00:00:00.000Z")
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/recruitment/sources/[sourceId]/authorization/route");
    const state = JSON.stringify({ cookies: [{ name: "sid", value: "secret-cookie" }], origins: [] });
    const response = await route.POST(jsonRequest({ storageState: state }), {
      params: Promise.resolve({ sourceId: "source-1" })
    });
    const payload = await response.json();
    const updateData = prisma.recruitmentSource.update.mock.calls[0][0].data;

    expect(response.status).toBe(200);
    expect(updateData.sessionCiphertext).not.toContain("secret-cookie");
    expect(updateData.sessionPreview).toBe("browser-session:1-cookie:0-origin");
    expect(payload.source.sessionPreview).toBe("browser-session:1-cookie:0-origin");
    expect(JSON.stringify(payload)).not.toContain("secret-cookie");
  });
});

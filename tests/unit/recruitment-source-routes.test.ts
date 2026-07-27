import { afterEach, describe, expect, it, vi } from "vitest";

function jsonRequest(body: unknown, url = "http://localhost/api/recruitment/sources") {
  return new Request(url, {
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

describe("recruitment source routes", () => {
  it("creates encrypted API sources and returns only credential previews", async () => {
    vi.stubEnv("RECRUITMENT_SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    const now = new Date("2026-07-27T00:00:00.000Z");
    const prisma = {
      recruitmentSource: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "source-1",
          ...data,
          sessionPreview: null,
          verificationStatus: "UNVERIFIED",
          lastVerifiedAt: null,
          lastSuccessfulSyncAt: null,
          createdAt: now,
          updatedAt: now
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/recruitment/sources/route");
    const response = await route.POST(jsonRequest({
      provider: "adzuna",
      sourceType: "AGGREGATED_API",
      displayName: "Adzuna US",
      apiKey: "adzuna-secret-key-1234567890",
      settings: { appId: "app-1", country: "us" }
    }));
    const payload = await response.json();
    const createData = prisma.recruitmentSource.create.mock.calls[0][0].data;

    expect(response.status).toBe(201);
    expect(createData.credentialCiphertext).not.toContain("adzuna-secret-key");
    expect(createData.credentialPreview).toBe("adzu...7890");
    expect(createData.settingsJson).toBe(JSON.stringify({ appId: "app-1", country: "us" }));
    expect(payload.source.credentialPreview).toBe("adzu...7890");
    expect(JSON.stringify(payload)).not.toContain("adzuna-secret-key");
    expect(JSON.stringify(payload)).not.toContain("credentialCiphertext");
  }, 10000);

  it("updates enabled state without touching stored credentials", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const prisma = {
      recruitmentSource: {
        update: vi.fn().mockResolvedValue({
          id: "source-1",
          provider: "adzuna",
          sourceType: "AGGREGATED_API",
          displayName: "Adzuna US",
          enabled: false,
          credentialPreview: "adzu...7890",
          sessionPreview: null,
          verificationStatus: "UNVERIFIED",
          lastVerifiedAt: null,
          lastSuccessfulSyncAt: null,
          settingsJson: "{}",
          createdAt: now,
          updatedAt: now
        })
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/recruitment/sources/[sourceId]/route");
    const response = await route.PATCH(
      jsonRequest({ enabled: false }, "http://localhost/api/recruitment/sources/source-1"),
      { params: Promise.resolve({ sourceId: "source-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.recruitmentSource.update.mock.calls[0][0].data).toEqual({ enabled: false });
    expect(payload.source.enabled).toBe(false);
  }, 10000);
});

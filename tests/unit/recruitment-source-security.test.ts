import { describe, expect, it } from "vitest";
import { parseRecruitmentSourceInput, serializeRecruitmentSource } from "@/lib/validators/recruitment";

describe("recruitment source security", () => {
  it("accepts aggregated API credentials but serializes only preview values", () => {
    const input = parseRecruitmentSourceInput({
      provider: "adzuna",
      sourceType: "AGGREGATED_API",
      displayName: "Adzuna US",
      apiKey: "adzuna-secret-key-1234567890",
      settings: { appId: "app-1", country: "us" }
    });

    expect(input.apiKey).toBe("adzuna-secret-key-1234567890");

    const serialized = serializeRecruitmentSource({
      id: "source-1",
      provider: "adzuna",
      sourceType: "AGGREGATED_API",
      displayName: "Adzuna US",
      enabled: true,
      credentialPreview: "adzu...7890",
      sessionPreview: null,
      verificationStatus: "UNVERIFIED",
      lastVerifiedAt: null,
      lastSuccessfulSyncAt: null,
      settingsJson: JSON.stringify({ country: "us" }),
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z")
    });

    expect(serialized).toMatchObject({
      id: "source-1",
      provider: "adzuna",
      credentialPreview: "adzu...7890",
      settings: { country: "us" }
    });
    expect(JSON.stringify(serialized)).not.toContain("adzuna-secret-key");
  });
});

import { describe, expect, it } from "vitest";
import { cleanupExpiredDigitalHumanMediaAssets } from "@/lib/media/storage/mediaCleanup";

describe("temporary media cleanup", () => {
  it("removes expired private objects and marks their rows cleaned", async () => {
    const removed: string[] = [];
    const statuses = new Map([["expired-audio", "ACTIVE"], ["future-video", "ACTIVE"]]);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const assets = [
      { id: "expired-audio", objectKey: "media/audio/a.wav", expiresAt: new Date("2026-08-01T11:00:00.000Z"), cleanupStatus: "ACTIVE", storageConfig: storageConfig() },
      { id: "future-video", objectKey: "media/video/b.mp4", expiresAt: new Date("2026-08-02T11:00:00.000Z"), cleanupStatus: "ACTIVE", storageConfig: storageConfig() }
    ];
    const client = {
      digitalHumanMediaAsset: {
        findMany: async () => assets.filter((asset) => asset.cleanupStatus === "ACTIVE" && asset.expiresAt <= now),
        updateMany: async ({ where, data }: { where: { id: string; cleanupStatus: string }; data: { cleanupStatus: string; cleanedAt?: Date | null } }) => {
          if (statuses.get(where.id) !== where.cleanupStatus) return { count: 0 };
          statuses.set(where.id, data.cleanupStatus);
          return { count: 1 };
        }
      }
    };

    const result = await cleanupExpiredDigitalHumanMediaAssets({
      now,
      client,
      readConfigSecret: () => "local-test-encryption-secret",
      createStorage: () => ({ removeObject: async (key: string) => { removed.push(key); } })
    });

    expect(result).toEqual({ cleaned: 1, failed: 0 });
    expect(removed).toEqual(["media/audio/a.wav"]);
    expect(statuses.get("expired-audio")).toBe("CLEANED");
    expect(statuses.get("future-video")).toBe("ACTIVE");
  });

  it("returns a failed asset to active so a later cleanup can retry", async () => {
    const status = { value: "ACTIVE" };
    const client = {
      digitalHumanMediaAsset: {
        findMany: async () => [{ id: "expired-video", objectKey: "media/video/a.mp4", expiresAt: new Date(0), cleanupStatus: "ACTIVE", storageConfig: storageConfig() }],
        updateMany: async ({ where, data }: { where: { cleanupStatus: string }; data: { cleanupStatus: string } }) => {
          if (status.value !== where.cleanupStatus) return { count: 0 };
          status.value = data.cleanupStatus;
          return { count: 1 };
        }
      }
    };

    const result = await cleanupExpiredDigitalHumanMediaAssets({
      now: new Date("2026-08-01T12:00:00.000Z"),
      client,
      readConfigSecret: () => "local-test-encryption-secret",
      createStorage: () => ({ removeObject: async () => { throw new Error("offline deletion failure"); } })
    });

    expect(result).toEqual({ cleaned: 0, failed: 1 });
    expect(status.value).toBe("ACTIVE");
  });
});

function storageConfig() {
  return {
    id: "oss-config",
    displayName: "Private OSS",
    providerKind: "ALI_OSS",
    endpoint: "oss-cn-hangzhou.aliyuncs.com",
    bucket: "private-media",
    region: "cn-hangzhou",
    credentialsCiphertext: "ciphertext",
    credentialsIv: "iv",
    credentialsTag: "tag",
    credentialsPreviewJson: null,
    enabled: true,
    createdAt: new Date(0),
    updatedAt: new Date(0)
  };
}

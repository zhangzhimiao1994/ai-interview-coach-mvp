import { describe, expect, it } from "vitest";
import {
  decryptOssCredentials,
  encryptOssCredentials,
  serializeMediaStorageConfig
} from "@/lib/media/storage/ossCredentials";
import { persistDigitalHumanMediaAsset } from "@/lib/media/storage/mediaAssets";

describe("media storage configuration", () => {
  it("uses the existing encrypted envelope and redacts credentials from its safe response", () => {
    const accessKeyId = "media-storage-access-key-id";
    const accessKeySecret = "media-storage-access-key-secret";
    const credentials = encryptOssCredentials(
      { accessKeyId, accessKeySecret },
      "config-secret"
    );
    const response = serializeMediaStorageConfig({
      id: "storage-1",
      displayName: "Interview media",
      providerKind: "ALI_OSS",
      endpoint: "oss-cn-beijing.aliyuncs.com",
      bucket: "private-interview-media",
      region: "cn-beijing",
      credentialsCiphertext: credentials.ciphertext,
      credentialsIv: credentials.iv,
      credentialsTag: credentials.tag,
      credentialsPreviewJson: credentials.previewJson,
      enabled: true
    });

    expect(credentials.ciphertext).not.toContain(accessKeySecret);
    expect(decryptOssCredentials(credentials, "config-secret")).toEqual({
      accessKeyId,
      accessKeySecret
    });
    expect(response).toEqual({
      id: "storage-1",
      displayName: "Interview media",
      providerKind: "ALI_OSS",
      endpoint: "oss-cn-beijing.aliyuncs.com",
      bucket: "private-interview-media",
      region: "cn-beijing",
      credentialsPreview: {
        accessKeyId: "medi****y-id",
        accessKeySecret: "medi****cret"
      },
      enabled: true
    });
    expect(JSON.stringify(response)).not.toContain(accessKeyId);
    expect(JSON.stringify(response)).not.toContain(accessKeySecret);
    expect(JSON.stringify(response)).not.toContain("https://");
  });

  it("persists only the opaque object metadata returned by private storage", async () => {
    const writes: unknown[] = [];
    const assets = {
      create: async (input: unknown) => {
        writes.push(input);
        return input;
      }
    };

    await persistDigitalHumanMediaAsset(
      {
        storageConfigId: "storage-1",
        objectKey: "media/audio/11111111-1111-4111-8111-111111111111.wav",
        mimeType: "audio/wav",
        byteLength: 96_044,
        purpose: "TTS_AUDIO",
        expiresAt: new Date("2026-08-01T00:00:00.000Z")
      },
      assets
    );

    expect(writes).toEqual([
      {
        data: {
          storageConfigId: "storage-1",
          objectKey: "media/audio/11111111-1111-4111-8111-111111111111.wav",
          mimeType: "audio/wav",
          byteLength: 96_044,
          purpose: "TTS_AUDIO",
          expiresAt: new Date("2026-08-01T00:00:00.000Z")
        }
      }
    ]);
    expect(JSON.stringify(writes)).not.toContain("https://");
  });

  it("persists immutable dimensions only for portrait assets", async () => {
    const writes: unknown[] = [];
    const assets = { create: async (input: unknown) => { writes.push(input); return input; } };

    await persistDigitalHumanMediaAsset({
      storageConfigId: "storage-1",
      objectKey: "media/portrait/11111111-1111-4111-8111-111111111111.png",
      mimeType: "image/png",
      byteLength: 32_000,
      purpose: "PORTRAIT",
      portraitWidth: 800,
      portraitHeight: 1000,
      expiresAt: null
    }, assets);

    expect(writes).toEqual([{ data: expect.objectContaining({
      purpose: "PORTRAIT",
      portraitWidth: 800,
      portraitHeight: 1000
    }) }]);
  });

  it("drops raw and unknown persisted credential previews", () => {
    const response = serializeMediaStorageConfig({
      id: "storage-1",
      displayName: "Interview media",
      providerKind: "ALI_OSS",
      endpoint: "oss-cn-beijing.aliyuncs.com",
      bucket: "private-interview-media",
      region: "cn-beijing",
      credentialsCiphertext: "ciphertext",
      credentialsIv: "iv",
      credentialsTag: "tag",
      credentialsPreviewJson: JSON.stringify({
        accessKeyId: "actual-access-key-id",
        accessKeySecret: "actual-secret",
        securityToken: "toke****oken",
        unexpected: "safe-looking-but-unknown"
      }),
      enabled: true
    });

    expect(response.credentialsPreview).toEqual({ securityToken: "toke****oken" });
    expect(JSON.stringify(response)).not.toContain("actual-access-key-id");
    expect(JSON.stringify(response)).not.toContain("actual-secret");
    expect(JSON.stringify(response)).not.toContain("safe-looking-but-unknown");
  });
});

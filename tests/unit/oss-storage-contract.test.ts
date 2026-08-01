import { describe, expect, it } from "vitest";
import {
  clampReadUrlExpiry,
  createPrivateObjectKey,
  OssPrivateMediaStorage,
  type OssObjectClient
} from "@/lib/media/storage/ossStorage";

describe("private OSS storage contract", () => {
  it("creates random UUID object keys without caller content", () => {
    const first = createPrivateObjectKey("audio", "wav");
    const second = createPrivateObjectKey("audio", "wav");

    expect(first).toMatch(/^media\/audio\/[0-9a-f-]{36}\.wav$/);
    expect(second).toMatch(/^media\/audio\/[0-9a-f-]{36}\.wav$/);
    expect(first).not.toBe(second);
    expect(first).not.toMatch(/candidate|question|岗位|姓名/i);
  });

  it.each([
    [1, 60],
    [60, 60],
    [480, 480],
    [900, 900],
    [3_600, 900]
  ])("clamps requested read URL expiry %i to %i seconds", (requested, expected) => {
    expect(clampReadUrlExpiry(requested)).toBe(expected);
  });

  it("stores opaque keys and asks the OSS boundary for a clamped private read URL", async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const client: OssObjectClient = {
      put: async (...args) => {
        calls.push({ name: "put", args });
      },
      signatureUrl: (name, options) => {
        calls.push({ name: "signatureUrl", args: [name, options] });
        return "https://example.invalid/signed-object";
      },
      delete: async (...args) => {
        calls.push({ name: "delete", args });
      }
    };
    const storage = new OssPrivateMediaStorage(client);

    const stored = await storage.putObject({
      purpose: "TTS_AUDIO",
      body: Buffer.from([1, 2, 3]),
      contentType: "audio/wav",
      expiresAt: new Date("2026-08-01T00:00:00.000Z")
    });
    const url = await storage.createReadUrl(stored.objectKey, 3_600);
    await storage.removeObject(stored.objectKey);

    expect(stored).toMatchObject({ byteLength: 3 });
    expect(stored.objectKey).toMatch(/^media\/audio\/[0-9a-f-]{36}\.wav$/);
    expect(JSON.stringify(stored)).not.toContain("https://");
    expect(url).toBe("https://example.invalid/signed-object");
    expect(calls).toEqual([
      {
        name: "put",
        args: [
          stored.objectKey,
          Buffer.from([1, 2, 3]),
          {
            headers: {
              "Content-Type": "audio/wav",
              "x-oss-object-acl": "private"
            }
          }
        ]
      },
      {
        name: "signatureUrl",
        args: [stored.objectKey, { expires: 900, method: "GET" }]
      },
      { name: "delete", args: [stored.objectKey] }
    ]);
  });

  it("accepts only an opaque deterministic render key when cache idempotency requires one", async () => {
    const puts: string[] = [];
    const storage = new OssPrivateMediaStorage({
      put: async (key) => { puts.push(key); },
      signatureUrl: () => "opaque-read-handle",
      delete: async () => undefined
    });
    const key = `media/video/render/${"a".repeat(64)}.mp4`;

    await expect(storage.putObject({
      purpose: "VIDEO_OUTPUT",
      body: Buffer.from([1]),
      contentType: "video/mp4",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      objectKey: key
    })).resolves.toEqual({ objectKey: key, byteLength: 1 });
    await expect(storage.putObject({
      purpose: "VIDEO_OUTPUT",
      body: Buffer.from([1]),
      contentType: "video/mp4",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      objectKey: "media/video/render/candidate-name.mp4"
    })).rejects.toThrow("deterministic object key");
    expect(puts).toEqual([key]);
  });
});

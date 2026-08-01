import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { createDigitalHumanVideoRuntimeHandler, RuntimeConfigValidationError } from "@/app/api/ai-services/digital-human-video-runtime/handler";
import { createInterviewerProfileHandler } from "@/app/api/admin/interviewer-profiles/handler";
import { createInterviewerProfileDeleteHandler } from "@/app/api/admin/interviewer-profiles/[profileId]/handler";
import { createPortraitUploadHandler, inspectImage, withinPortraitDecodedBudget } from "@/app/api/admin/interviewer-profiles/portrait/handler";

const admin = { id: "admin-1", role: "SUPER_ADMIN" };

describe("digital-human administrator routes", () => {
  it("rejects candidates and preserves the last valid runtime on invalid model/profile writes", async () => {
    let saved: unknown = { mode: "AUTO_RACE" };
    let writes = 0;
    const handler = createDigitalHumanVideoRuntimeHandler({
      authorizeAdmin: async () => null,
      loadConfig: async () => ({ runtime: saved, storage: null, profiles: [], models: [] }),
      saveConfig: async (input) => { writes += 1; saved = input; return { runtime: input, storage: null, profiles: [], models: [] }; }
    });
    const denied = await handler(new Request("http://localhost/api/ai-services/digital-human-video-runtime", { method: "PUT", body: "{}", headers: { "content-type": "application/json", origin: "http://localhost" } }));
    expect(denied.status).toBe(401);
    expect(writes).toBe(0);

    const invalid = createDigitalHumanVideoRuntimeHandler({
      authorizeAdmin: async () => admin,
      loadConfig: async () => ({ runtime: saved, storage: null, profiles: [], models: [] }),
      saveConfig: async () => { writes += 1; throw new RuntimeConfigValidationError("MODEL_PROVIDER_MISMATCH"); }
    });
    const response = await invalid(new Request("http://localhost/api/ai-services/digital-human-video-runtime", {
      method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify(validRuntimeBody())
    }));
    expect(response.status).toBe(400);
    expect(writes).toBe(1);
    expect(saved).toEqual({ mode: "AUTO_RACE" });
    expect(JSON.stringify(await response.json())).not.toMatch(/ciphertext|accessKeySecret|rawResponse|objectKey/i);
  });

  it("retains encrypted OSS credentials when secret fields are omitted and redacts all envelopes", async () => {
    let received: unknown = null;
    const handler = createDigitalHumanVideoRuntimeHandler({
      authorizeAdmin: async () => admin,
      loadConfig: async () => ({ runtime: null, storage: null, profiles: [], models: [] }),
      saveConfig: async (input) => {
        received = input;
        return { runtime: input.runtime, storage: { id: "oss", displayName: "OSS", endpoint: "oss-cn.aliyuncs.com", bucket: "private-bucket", region: "cn-hangzhou", credentialsPreview: { accessKeyId: "LTAI****9xyz" }, enabled: true }, profiles: [], models: [] };
      }
    });
    const body = validRuntimeBody();
    body.storage = { id: "oss", displayName: "OSS", endpoint: "oss-cn.aliyuncs.com", bucket: "private-bucket", region: "cn-hangzhou", enabled: true };
    const response = await handler(new Request("http://localhost/api/ai-services/digital-human-video-runtime", { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect((received as { storage: { credentials?: unknown } }).storage.credentials).toBeUndefined();
    const text = JSON.stringify(await response.json());
    expect(text).toContain("LTAI****9xyz");
    expect(text).not.toMatch(/ciphertext|credentialsIv|credentialsTag|objectKey|signedUrl/i);
  });

  it("returns a safe 409 when an administrator submits a stale storage version", async () => {
    const handler = createDigitalHumanVideoRuntimeHandler({
      authorizeAdmin: async () => admin,
      loadConfig: async () => ({ runtime: null, storage: null, profiles: [], models: [] }),
      saveStorage: async () => { throw new RuntimeConfigValidationError("STALE_STORAGE_CONFIG"); }
    });

    const response = await handler(new Request("http://localhost/api/ai-services/digital-human-video-runtime", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        action: "SAVE_STORAGE",
        storage: {
          id: "stale-storage",
          displayName: "Private OSS",
          endpoint: "oss-cn-hangzhou.aliyuncs.com",
          bucket: "private-bucket",
          region: "cn-hangzhou",
          enabled: true
        }
      })
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "STALE_STORAGE_CONFIG" });
  });

  it("requires paid confirmation before delegating diagnostics", async () => {
    let calls = 0;
    const handler = createInterviewerProfileHandler({
      authorizeAdmin: async () => admin,
      listProfiles: async () => [],
      saveProfile: async (input) => input,
      runPaidDiagnostic: async () => { calls += 1; return { status: "REACHABLE", safeCode: "OK" }; }
    });
    const unconfirmed = await handler(new Request("http://localhost/api/admin/interviewer-profiles", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ action: "PAID_DIAGNOSTIC", providerKind: "ALIBABA_EMO", confirmPaidRequest: false }) }));
    expect(unconfirmed.status).toBe(400);
    expect(calls).toBe(0);
    const confirmed = await handler(new Request("http://localhost/api/admin/interviewer-profiles", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ action: "PAID_DIAGNOSTIC", providerKind: "ALIBABA_EMO", confirmPaidRequest: true }) }));
    expect(confirmed.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("deletes only unreferenced profiles with exact runtime matching", async () => {
    const deleted: string[] = [];
    const handler = createInterviewerProfileDeleteHandler({
      authorizeAdmin: async () => admin,
      deleteProfile: async (profileId) => {
        deleted.push(profileId);
        return profileId === "profile-primary" ? "IN_USE" : profileId === "missing" ? "NOT_FOUND" : "DELETED";
      }
    });
    const invoke = (profileId: string, origin = "http://localhost") => handler(new Request(`http://localhost/api/admin/interviewer-profiles/${profileId}`, { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ profileId }) });
    expect((await invoke("profile-primary")).status).toBe(409);
    expect((await invoke("profile-primary-copy")).status).toBe(204);
    expect((await invoke("missing")).status).toBe(404);
    expect(deleted).toEqual(["profile-primary", "profile-primary-copy", "missing"]);
  });

  it("fails closed on delete authentication, CSRF, and database errors", async () => {
    let calls = 0;
    const denied = createInterviewerProfileDeleteHandler({ authorizeAdmin: async () => null, deleteProfile: async () => { calls += 1; return "DELETED"; } });
    const deniedResponse = await denied(new Request("http://localhost/api/admin/interviewer-profiles/p1", { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ profileId: "p1" }) });
    expect(deniedResponse.status).toBe(401);
    expect(calls).toBe(0);

    const handler = createInterviewerProfileDeleteHandler({ authorizeAdmin: async () => admin, deleteProfile: async () => { calls += 1; throw new Error("database details"); } });
    const csrf = await handler(new Request("http://localhost/api/admin/interviewer-profiles/p1", { method: "DELETE", headers: { origin: "https://evil.example" } }), { params: Promise.resolve({ profileId: "p1" }) });
    expect(csrf.status).toBe(403);
    expect(calls).toBe(0);
    const failed = await handler(new Request("http://localhost/api/admin/interviewer-profiles/p1", { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ profileId: "p1" }) });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("database details");
  });
});

describe("private portrait upload", () => {
  it("sniffs PNG bytes/dimensions, uploads privately, and compensates persistence failure", async () => {
    const removed: string[] = [];
    const handler = createPortraitUploadHandler({
      authorizeAdmin: async () => admin,
      uploadPrivate: async (input) => {
        expect(input.contentType).toBe("image/png");
        expect(input.width).toBe(400);
        expect(input.height).toBe(500);
        return { objectKey: "media/portrait/opaque.png", byteLength: input.body.byteLength };
      },
      persistAsset: async (input) => { expect(input.expiresAt).toBeNull(); throw new Error("database failed"); },
      removePrivate: async (key) => { removed.push(key); }
    });
    const form = new FormData();
    form.set("portrait", new File([png(400, 500)], "not-really.txt", { type: "text/plain" }));
    const response = await handler(new Request("http://localhost/api/admin/interviewer-profiles/portrait", { method: "POST", headers: { origin: "http://localhost" }, body: form }));
    expect(response.status).toBe(500);
    expect(removed).toEqual(["media/portrait/opaque.png"]);
    expect(JSON.stringify(await response.json())).not.toContain("opaque.png");
  });

  it("rejects forged headers, undersized dimensions, and oversized files before upload", async () => {
    let uploads = 0;
    const handler = createPortraitUploadHandler({
      authorizeAdmin: async () => admin,
      uploadPrivate: async () => { uploads += 1; return { objectKey: "never", byteLength: 1 }; },
      persistAsset: async () => ({ id: "never" }),
      removePrivate: async () => undefined
    });
    for (const file of [
      new File([new Uint8Array([1, 2, 3])], "fake.png", { type: "image/png" }),
      new File([png(400, 500).subarray(0, 24)], "truncated.png", { type: "image/png" }),
      new File([png(399, 500)], "small.png", { type: "image/png" }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })
    ]) {
      const form = new FormData(); form.set("portrait", file);
      const response = await handler(new Request("http://localhost/api/admin/interviewer-profiles/portrait", { method: "POST", headers: { origin: "http://localhost" }, body: form }));
      expect(response.status).toBe(400);
    }
    expect(uploads).toBe(0);
  });

  it("keeps concurrent upload storage contexts isolated and persists portraits without expiry", async () => {
    const persisted: Array<{ key: string; storage?: string; expiresAt: null; width: number; height: number }> = [];
    let sequence = 0;
    const handler = createPortraitUploadHandler({ authorizeAdmin: async () => admin, uploadPrivate: async (input) => ({ objectKey: `portrait-${++sequence}`, byteLength: input.body.length, storageConfigId: `storage-${sequence}` }), persistAsset: async (input) => { persisted.push({ key: input.objectKey, storage: input.storageConfigId, expiresAt: input.expiresAt, width: input.width, height: input.height }); return { id: `asset-${persisted.length}` }; }, removePrivate: async () => undefined });
    const make = () => { const form = new FormData(); form.set("portrait", new File([png(400, 500)], "portrait.png", { type: "image/png" })); return handler(new Request("http://localhost/api/admin/interviewer-profiles/portrait", { method: "POST", headers: { origin: "http://localhost" }, body: form })); };
    const responses = await Promise.all([make(), make()]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(persisted).toEqual(expect.arrayContaining([{ key: "portrait-1", storage: "storage-1", expiresAt: null, width: 400, height: 500 }, { key: "portrait-2", storage: "storage-2", expiresAt: null, width: 400, height: 500 }]));
  });

  it("rejects PNG CRC, empty data, invalid filters, and decoded-length forgeries", () => {
    const corruptCrc = Buffer.from(png(400, 500)); corruptCrc[corruptCrc.length - 1] ^= 1;
    const emptyData = pngWithRaw(400, 500, Buffer.alloc(0), true);
    const invalidLength = pngWithRaw(400, 500, Buffer.alloc(20));
    const invalidFilterRaw = Buffer.alloc(500 * (1 + 400 * 4)); invalidFilterRaw[0] = 5;
    expect(inspectImage(corruptCrc)).toBeNull();
    expect(inspectImage(emptyData)).toBeNull();
    expect(inspectImage(invalidLength)).toBeNull();
    expect(inspectImage(pngWithRaw(400, 500, invalidFilterRaw))).toBeNull();
  });

  it("rejects decoded portrait payloads above the bounded memory budget before inflation", () => {
    expect(withinPortraitDecodedBudget(4096, 4096, 4, 8)).toBe(false);
    expect(withinPortraitDecodedBudget(3000, 3000, 4, 8)).toBe(true);
  });

  it("accepts a marker-complete JPEG and rejects an empty scan shell", () => {
    expect(inspectImage(jpeg(400, 500))).toMatchObject({ contentType: "image/jpeg", width: 400, height: 500 });
    expect(inspectImage(jpegShell(400, 500))).toBeNull();
  });
});

function validRuntimeBody(): any {
  return {
    runtime: { mode: "AUTO_RACE", maxWaitMs: 8000, lingmouPollMs: [3000, 6000], emoPollMs: [8000], synchronizeProfiles: true, primaryProfileId: "profile-1", secondaryProfileId: null, lingmouModelId: "ling", emoModelId: "emo" },
    storage: null
  };
}

function png(width: number, height: number) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  return pngWithRaw(width, height, scanlines);
}

function pngWithRaw(width: number, height: number, scanlines: Buffer, emptyIdat = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", emptyIdat ? Buffer.alloc(0) : deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type: string, payload: Buffer) { const name = Buffer.from(type); const result = Buffer.alloc(12 + payload.length); result.writeUInt32BE(payload.length, 0); name.copy(result, 4); payload.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([name, payload])), 8 + payload.length); return result; }
function crc32(value: Buffer) { let crc = 0xffffffff; for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function jpeg(width: number, height: number) { const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00]); const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]); const dqt = jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])); const counts = Buffer.alloc(16); counts[0] = 1; const dht = jpegSegment(0xc4, Buffer.concat([Buffer.from([0]), counts, Buffer.from([0])])); return Buffer.concat([Buffer.from([0xff, 0xd8]), dqt, dht, sof, sos, Buffer.from([0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9])]); }
function jpegShell(width: number, height: number) { const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00]); const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]); return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, Buffer.from([0x00, 0xff, 0xd9])]); }
function jpegSegment(marker: number, payload: Buffer) { const segment = Buffer.alloc(4 + payload.length); segment[0] = 0xff; segment[1] = marker; segment.writeUInt16BE(payload.length + 2, 2); payload.copy(segment, 4); return segment; }

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { decryptOssCredentials } from "./ossCredentials";
import type {
  MediaStorageConfigRecord,
  PrivateMediaPurpose,
  PrivateMediaStorage
} from "./types";

const require = createRequire(import.meta.url);
const OssClient = require("ali-oss") as new (options: {
  accessKeyId: string;
  accessKeySecret: string;
  stsToken?: string;
  bucket: string;
  endpoint: string;
  region?: string;
  secure: boolean;
}) => OssObjectClient;

const minReadUrlExpirySeconds = 60;
const maxReadUrlExpirySeconds = 900;

export type OssObjectClient = {
  put(
    objectKey: string,
    body: Buffer,
    options: { headers: { "Content-Type": string } }
  ): Promise<unknown>;
  signatureUrl(
    objectKey: string,
    options: { expires: number; method: "GET" }
  ): string;
  delete(objectKey: string): Promise<unknown>;
};

type PrivateObjectCategory = "portrait" | "audio" | "video";

export function createPrivateObjectKey(
  category: PrivateObjectCategory,
  extension: string
) {
  if (!/^[a-z0-9]+$/.test(extension)) {
    throw new Error("Object extension must contain only lowercase letters and digits");
  }

  return `media/${category}/${randomUUID()}.${extension}`;
}

export function clampReadUrlExpiry(expiresInSeconds: number) {
  if (!Number.isFinite(expiresInSeconds)) {
    return minReadUrlExpirySeconds;
  }

  return Math.max(
    minReadUrlExpirySeconds,
    Math.min(maxReadUrlExpirySeconds, Math.floor(expiresInSeconds))
  );
}

function privateObjectFormat(purpose: PrivateMediaPurpose, contentType: string) {
  switch (purpose) {
    case "PORTRAIT":
      return {
        category: "portrait" as const,
        extension: contentType === "image/png" ? "png" : "jpg"
      };
    case "TTS_AUDIO":
      return {
        category: "audio" as const,
        extension: contentType === "audio/mpeg" ? "mp3" : "wav"
      };
    case "VIDEO_OUTPUT":
      return { category: "video" as const, extension: "mp4" };
  }
}

export class OssPrivateMediaStorage implements PrivateMediaStorage {
  constructor(private readonly client: OssObjectClient) {}

  async putObject(input: {
    purpose: PrivateMediaPurpose;
    body: Buffer;
    contentType: string;
    expiresAt: Date;
  }) {
    const format = privateObjectFormat(input.purpose, input.contentType);
    const objectKey = createPrivateObjectKey(format.category, format.extension);

    await this.client.put(objectKey, input.body, {
      headers: { "Content-Type": input.contentType }
    });

    return { objectKey, byteLength: input.body.byteLength };
  }

  async createReadUrl(objectKey: string, expiresInSeconds: number) {
    return this.client.signatureUrl(objectKey, {
      expires: clampReadUrlExpiry(expiresInSeconds),
      method: "GET"
    });
  }

  async removeObject(objectKey: string) {
    await this.client.delete(objectKey);
  }
}

export function createOssPrivateMediaStorage(
  config: MediaStorageConfigRecord,
  configSecret: string
) {
  if (
    !config.credentialsCiphertext ||
    !config.credentialsIv ||
    !config.credentialsTag
  ) {
    throw new Error("OSS credentials are not configured");
  }

  const credentials = decryptOssCredentials(
    {
      ciphertext: config.credentialsCiphertext,
      iv: config.credentialsIv,
      tag: config.credentialsTag
    },
    configSecret
  );
  const client = new OssClient({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    stsToken: credentials.securityToken,
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region ?? undefined,
    secure: true
  });

  return new OssPrivateMediaStorage(client);
}

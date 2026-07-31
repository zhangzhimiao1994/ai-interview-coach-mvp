import {
  decryptCredentialMap,
  encryptCredentialMap,
  previewCredentialMap,
  type EncryptedSecret
} from "@/lib/domain/aiServices";
import type { MediaStorageConfigRecord, OssCredentials } from "./types";

export type EncryptedOssCredentials = EncryptedSecret & {
  previewJson: string;
};

function requiredCredential(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`OSS ${field} is required`);
  }

  return value.trim();
}

export function encryptOssCredentials(
  credentials: OssCredentials,
  configSecret: string
): EncryptedOssCredentials {
  const normalized: OssCredentials = {
    accessKeyId: requiredCredential(credentials.accessKeyId, "access key ID"),
    accessKeySecret: requiredCredential(
      credentials.accessKeySecret,
      "access key secret"
    )
  };

  if (credentials.securityToken?.trim()) {
    normalized.securityToken = credentials.securityToken.trim();
  }

  return {
    ...encryptCredentialMap(normalized, configSecret),
    previewJson: JSON.stringify(previewCredentialMap(normalized))
  };
}

export function decryptOssCredentials(
  encrypted: EncryptedSecret,
  configSecret: string
): OssCredentials {
  const credentials = decryptCredentialMap(encrypted, configSecret);
  const result: OssCredentials = {
    accessKeyId: requiredCredential(credentials.accessKeyId, "access key ID"),
    accessKeySecret: requiredCredential(credentials.accessKeySecret, "access key secret")
  };

  if (credentials.securityToken?.trim()) {
    result.securityToken = credentials.securityToken.trim();
  }

  return result;
}

const previewableCredentialFields = [
  "accessKeyId",
  "accessKeySecret",
  "securityToken"
] as const;

type PreviewableCredentialField = (typeof previewableCredentialFields)[number];

function isPreviewableCredentialField(value: string): value is PreviewableCredentialField {
  return (previewableCredentialFields as readonly string[]).includes(value);
}

function isMaskedCredentialPreview(value: string) {
  return /^[^*\s]{0,4}\*{4}[^*\s]{0,4}$/.test(value);
}

function parseCredentialPreview(value: string | null) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [PreviewableCredentialField, string] =>
          isPreviewableCredentialField(entry[0]) &&
          typeof entry[1] === "string" &&
          isMaskedCredentialPreview(entry[1])
      )
    );
  } catch {
    return {};
  }
}

export function serializeMediaStorageConfig(config: MediaStorageConfigRecord) {
  return {
    id: config.id,
    displayName: config.displayName,
    providerKind: config.providerKind,
    endpoint: config.endpoint,
    bucket: config.bucket,
    region: config.region,
    credentialsPreview: parseCredentialPreview(config.credentialsPreviewJson),
    enabled: config.enabled
  };
}

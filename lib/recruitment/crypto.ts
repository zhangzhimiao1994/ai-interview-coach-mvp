import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type RecruitmentSecretEnvelope = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function resolveSecret(secret?: string) {
  const value = secret || process.env.RECRUITMENT_SESSION_SECRET || "";

  if (value.length < 32) {
    throw new Error("RECRUITMENT_SESSION_SECRET_REQUIRED");
  }

  return createHash("sha256").update(value).digest();
}

export function encryptRecruitmentSecret(value: string, secret?: string): RecruitmentSecretEnvelope {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", resolveSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64")
  };
}

export function decryptRecruitmentSecret(envelope: RecruitmentSecretEnvelope, secret?: string) {
  const decipher = createDecipheriv("aes-256-gcm", resolveSecret(secret), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function getRecruitmentSecretPreview(value: string) {
  const trimmed = value.trim();

  if (trimmed.length <= 8) {
    return "*".repeat(trimmed.length);
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

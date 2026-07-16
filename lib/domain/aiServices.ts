import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AiCapability } from "./aiServiceConstants";
import { isPlaceholderSecret } from "@/lib/security/requestGuards";
export { aiCapabilities, aiProviderTypes, type AiCapability, type AiProviderType } from "./aiServiceConstants";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export type CredentialMap = Record<string, string>;

type ModelDefaultState = {
  id: string;
  capability: AiCapability;
  isDefault: boolean;
};

export class AiConfigSecretMissingError extends Error {
  constructor() {
    super("AI_CONFIG_SECRET is required in production to store provider API keys.");
    this.name = "AiConfigSecretMissingError";
  }
}

export class AiConfigDecryptionError extends Error {
  constructor(cause: unknown) {
    super("Stored secret could not be decrypted", { cause });
    this.name = "AiConfigDecryptionError";
  }
}

const canonicalBase64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeCanonicalBase64(value: string) {
  if (typeof value !== "string" || !canonicalBase64Pattern.test(value)) {
    throw new Error("Encrypted secret field is not canonical base64");
  }

  const decoded = Buffer.from(value, "base64");

  if (decoded.toString("base64") !== value) {
    throw new Error("Encrypted secret field is not canonical base64");
  }

  return decoded;
}

export function maskSecret(secret: string) {
  const trimmed = secret.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 4) {
    return "****";
  }

  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

export function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(secret: string, configSecret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(configSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64")
  };
}

export function decryptSecret(encrypted: EncryptedSecret, configSecret: string) {
  try {
    const ciphertext = decodeCanonicalBase64(encrypted.ciphertext);
    const iv = decodeCanonicalBase64(encrypted.iv);
    const tag = decodeCanonicalBase64(encrypted.tag);

    if (iv.length !== 12 || tag.length !== 16) {
      throw new Error("Encrypted secret envelope has invalid field lengths");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(configSecret),
      iv,
      { authTagLength: 16 }
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return plaintext.toString("utf8");
  } catch (error) {
    throw new AiConfigDecryptionError(error);
  }
}

export function encryptCredentialMap(
  credentials: CredentialMap,
  configSecret: string
) {
  return encryptSecret(JSON.stringify(credentials), configSecret);
}

export function decryptCredentialMap(
  encrypted: EncryptedSecret,
  configSecret: string
): CredentialMap {
  try {
    const parsed = JSON.parse(decryptSecret(encrypted, configSecret)) as unknown;

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Decrypted credential payload is not an object");
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"
      )
    );
  } catch (error) {
    throw new Error("Stored credentials are invalid", { cause: error });
  }
}

export function previewCredentialMap(credentials: CredentialMap): CredentialMap {
  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [key, maskSecret(value)])
  );
}

export function readAiConfigSecret(env: Record<string, string | undefined> = process.env) {
  const configured = env.AI_CONFIG_SECRET?.trim();

  if (configured) {
    if (env.NODE_ENV === "production" && isPlaceholderSecret(configured)) {
      throw new Error("AI_CONFIG_SECRET must be changed before production use.");
    }

    return configured;
  }

  if (env.NODE_ENV === "production") {
    throw new AiConfigSecretMissingError();
  }

  return "development-ai-config-secret-change-me";
}

export function nextDefaultFlags(
  models: ModelDefaultState[],
  selectedModelId: string,
  selectedCapability: AiCapability
) {
  return Object.fromEntries(
    models.map((model) => [
      model.id,
      model.capability === selectedCapability ? model.id === selectedModelId : model.isDefault
    ])
  ) as Record<string, boolean>;
}

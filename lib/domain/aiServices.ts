import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AiCapability } from "./aiServiceConstants";
import { isPlaceholderSecret } from "@/lib/security/requestGuards";
export { aiCapabilities, aiProviderTypes, type AiCapability, type AiProviderType } from "./aiServiceConstants";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

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

export function maskSecret(secret: string) {
  const trimmed = secret.trim();

  if (!trimmed) {
    return "";
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
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(configSecret),
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
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

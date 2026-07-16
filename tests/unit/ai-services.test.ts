import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  readAiConfigSecret,
  maskSecret
} from "@/lib/domain/aiServices";

function tamperBase64(value: string) {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

function expectSafeDecryptionFailure(action: () => unknown) {
  let caught: unknown;

  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({
    name: "AiConfigDecryptionError",
    message: "Stored secret could not be decrypted"
  });
  expect((caught as Error & { cause?: unknown }).cause).toBeDefined();
  expect((caught as Error).message).not.toMatch(/auth|cipher|iv|tag|base64|key/i);
}

describe("AI service configuration helpers", () => {
  it("masks provider API keys without revealing the full value", () => {
    expect(maskSecret("sk-live-1234567890abcdef")).toBe("sk-l****cdef");
    expect(maskSecret("abc123")).toBe("ab****23");
    expect(maskSecret("")).toBe("");
  });

  it("encrypts and decrypts provider secrets", () => {
    const encrypted = encryptSecret("sk-test-secret", "unit-test-secret");

    expect(encrypted.ciphertext).not.toContain("sk-test-secret");
    expect(decryptSecret(encrypted, "unit-test-secret")).toBe("sk-test-secret");
  });

  it.each([
    ["wrong key", (encrypted: ReturnType<typeof encryptSecret>) => encrypted, "wrong-secret"],
    [
      "tampered ciphertext",
      (encrypted: ReturnType<typeof encryptSecret>) => ({
        ...encrypted,
        ciphertext: tamperBase64(encrypted.ciphertext)
      }),
      "unit-test-secret"
    ],
    [
      "tampered authentication tag",
      (encrypted: ReturnType<typeof encryptSecret>) => ({
        ...encrypted,
        tag: tamperBase64(encrypted.tag)
      }),
      "unit-test-secret"
    ]
  ])("returns a safe error for %s", (_case, mutate, decryptionSecret) => {
    const encrypted = mutate(
      encryptSecret("sk-test-secret", "unit-test-secret")
    );

    expectSafeDecryptionFailure(() => decryptSecret(encrypted, decryptionSecret));
  });

  it.each([
    ["ciphertext", "YQ"],
    ["iv", "AAAAAAAAAAAAAAAA="],
    ["tag", "______________________=="]
  ] as const)("rejects non-canonical base64 in the %s", (field, value) => {
    const encrypted = encryptSecret("sk-test-secret", "unit-test-secret");

    expectSafeDecryptionFailure(() =>
      decryptSecret({ ...encrypted, [field]: value }, "unit-test-secret")
    );
  });

  it.each([
    ["iv", 11],
    ["iv", 13],
    ["tag", 15],
    ["tag", 17]
  ] as const)("rejects a %s with %i decoded bytes", (field, length) => {
    const encrypted = encryptSecret("sk-test-secret", "unit-test-secret");

    expectSafeDecryptionFailure(() =>
      decryptSecret(
        { ...encrypted, [field]: Buffer.alloc(length).toString("base64") },
        "unit-test-secret"
      )
    );
  });

  it("rejects the production placeholder encryption secret", () => {
    expect(() =>
      readAiConfigSecret({
        NODE_ENV: "production",
        AI_CONFIG_SECRET: "change-this-before-production"
      })
    ).toThrow("AI_CONFIG_SECRET must be changed");
  });
});

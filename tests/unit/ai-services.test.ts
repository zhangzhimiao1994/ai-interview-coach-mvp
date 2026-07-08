import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  readAiConfigSecret,
  maskSecret,
  nextDefaultFlags,
  type AiCapability
} from "@/lib/domain/aiServices";

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

  it("marks only the selected model as default for a capability", () => {
    const capability: AiCapability = "REPORT_ANALYSIS";
    const flags = nextDefaultFlags(
      [
        { id: "model-a", capability, isDefault: true },
        { id: "model-b", capability, isDefault: false },
        { id: "model-c", capability: "TEXT_TO_SPEECH", isDefault: true }
      ],
      "model-b",
      capability
    );

    expect(flags).toEqual({
      "model-a": false,
      "model-b": true,
      "model-c": true
    });
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

import { describe, expect, it } from "vitest";
import { decryptRecruitmentSecret, encryptRecruitmentSecret, getRecruitmentSecretPreview } from "@/lib/recruitment/crypto";

describe("recruitment credential encryption", () => {
  it("encrypts values without leaking plaintext and decrypts with the same secret", () => {
    const encrypted = encryptRecruitmentSecret("adzuna-key-123456", "0123456789abcdef0123456789abcdef");
    expect(encrypted.ciphertext).not.toContain("adzuna-key");
    expect(encrypted.iv).toHaveLength(24);
    expect(encrypted.tag).toHaveLength(24);
    expect(decryptRecruitmentSecret(encrypted, "0123456789abcdef0123456789abcdef")).toBe("adzuna-key-123456");
    expect(getRecruitmentSecretPreview("adzuna-key-123456")).toBe("adzu...3456");
  });
});

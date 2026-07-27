import { describe, expect, it } from "vitest";
import {
  classifyBrowserAuthorizationState,
  createEncryptedBrowserSessionRecord,
  sanitizeBrowserSessionPreview
} from "@/lib/recruitment/browserSessions";
import { decryptRecruitmentSecret } from "@/lib/recruitment/crypto";

describe("recruitment browser session records", () => {
  it("redacts browser storage and classifies authorization states", () => {
    const state = JSON.stringify({ cookies: [{ name: "sid", value: "secret-cookie" }], origins: [] });

    expect(sanitizeBrowserSessionPreview(state)).toBe("browser-session:1-cookie:0-origin");
    expect(classifyBrowserAuthorizationState({ hasSession: false, verificationStatus: "UNVERIFIED" })).toBe("AUTH_REQUIRED");
    expect(classifyBrowserAuthorizationState({ hasSession: true, verificationStatus: "VERIFIED" })).toBe("READY");
  });

  it("encrypts Playwright storage state without storing usernames or passwords", () => {
    const state = JSON.stringify({
      cookies: [{ name: "sid", value: "secret-cookie" }],
      origins: [{ origin: "https://www.linkedin.com", localStorage: [{ name: "token", value: "secret-token" }] }]
    });
    const record = createEncryptedBrowserSessionRecord(state, "0123456789abcdef0123456789abcdef");

    expect(record.sessionPreview).toBe("browser-session:1-cookie:1-origin");
    expect(JSON.stringify(record)).not.toContain("secret-cookie");
    expect(decryptRecruitmentSecret({
      ciphertext: record.sessionCiphertext,
      iv: record.sessionIv,
      tag: record.sessionTag
    }, "0123456789abcdef0123456789abcdef")).toBe(state);
  });
});

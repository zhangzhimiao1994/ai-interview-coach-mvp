import { encryptRecruitmentSecret } from "@/lib/recruitment/crypto";

type BrowserStorageState = {
  cookies?: unknown[];
  origins?: unknown[];
};

export type BrowserAuthorizationState = {
  hasSession: boolean;
  verificationStatus: string;
};

function parseStorageState(value: string): BrowserStorageState {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BROWSER_STORAGE_STATE_INVALID");
  }

  const state = parsed as BrowserStorageState;
  if (state.cookies !== undefined && !Array.isArray(state.cookies)) {
    throw new Error("BROWSER_STORAGE_STATE_INVALID");
  }
  if (state.origins !== undefined && !Array.isArray(state.origins)) {
    throw new Error("BROWSER_STORAGE_STATE_INVALID");
  }

  return state;
}

export function sanitizeBrowserSessionPreview(storageState: string) {
  const state = parseStorageState(storageState);
  return `browser-session:${state.cookies?.length || 0}-cookie:${state.origins?.length || 0}-origin`;
}

export function classifyBrowserAuthorizationState(state: BrowserAuthorizationState) {
  if (!state.hasSession) return "AUTH_REQUIRED";
  if (state.verificationStatus === "VERIFIED") return "READY";
  if (state.verificationStatus === "PAUSED") return "PAUSED";
  if (state.verificationStatus === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  return "NEEDS_VERIFICATION";
}

export function createEncryptedBrowserSessionRecord(storageState: string, secret?: string) {
  parseStorageState(storageState);
  const envelope = encryptRecruitmentSecret(storageState, secret);

  return {
    sessionCiphertext: envelope.ciphertext,
    sessionIv: envelope.iv,
    sessionTag: envelope.tag,
    sessionPreview: sanitizeBrowserSessionPreview(storageState)
  };
}

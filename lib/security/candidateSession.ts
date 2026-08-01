export const candidateSessionCookieName = "aic_candidate_session";

export type CandidateSessionPayload = {
  trainingSessionId: string;
  candidateId: string;
};

type SignedCandidateSessionPayload = CandidateSessionPayload & { exp: number };

function encoder() {
  return new TextEncoder();
}

function base64UrlEncode(value: string | ArrayBuffer) {
  const bytes = typeof value === "string" ? encoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = typeof atob === "function"
    ? atob(padded)
    : Buffer.from(padded, "base64").toString("binary");
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, encoder().encode(value));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function createCandidateSessionCookie(
  payload: CandidateSessionPayload,
  secret: string,
  ttlMs = 12 * 60 * 60 * 1000,
  now = Date.now()
) {
  if (!payload.trainingSessionId.trim() || !payload.candidateId.trim()) {
    throw new Error("Candidate session payload is invalid");
  }
  const body = base64UrlEncode(JSON.stringify({ ...payload, exp: now + ttlMs }));
  return `${body}.${base64UrlEncode(await sign(body, secret))}`;
}

export async function verifyCandidateSessionCookie(
  value: string | undefined | null,
  secret: string,
  now = Date.now()
) {
  if (!value) return { ok: false as const };
  const parts = value.split(".");
  if (parts.length !== 2) return { ok: false as const };
  const [body, signature] = parts;
  if (!body || !signature) return { ok: false as const };
  const expected = base64UrlEncode(await sign(body, secret));
  if (!safeEqual(signature, expected)) return { ok: false as const };
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as Partial<SignedCandidateSessionPayload>;
    if (
      typeof parsed.trainingSessionId !== "string" ||
      typeof parsed.candidateId !== "string" ||
      !parsed.trainingSessionId.trim() ||
      !parsed.candidateId.trim() ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= now
    ) return { ok: false as const };
    return {
      ok: true as const,
      session: {
        trainingSessionId: parsed.trainingSessionId,
        candidateId: parsed.candidateId
      }
    };
  } catch {
    return { ok: false as const };
  }
}

export function candidateSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60
  };
}

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

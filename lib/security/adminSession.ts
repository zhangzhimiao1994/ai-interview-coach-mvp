export const adminSessionCookieName = "aic_admin_session";

type AdminSessionSource = "database" | "setup";

export type AdminSessionPayload = {
  subject: string;
  username: string;
  source: AdminSessionSource;
};

type SignedSessionPayload = AdminSessionPayload & {
  exp: number;
};

function textEncoder() {
  return new TextEncoder();
}

function base64UrlEncode(value: string | ArrayBuffer) {
  const bytes = typeof value === "string"
    ? textEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

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
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

async function hmacSha256(value: string, secret: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return crypto.subtle.sign("HMAC", cryptoKey, textEncoder().encode(value));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

export async function createAdminSessionCookie(
  payload: AdminSessionPayload,
  secret: string,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  now = Date.now()
) {
  const body = base64UrlEncode(JSON.stringify({ ...payload, exp: now + ttlMs }));
  const signature = base64UrlEncode(await hmacSha256(body, secret));

  return `${body}.${signature}`;
}

export async function verifyAdminSessionCookie(
  cookieValue: string | undefined | null,
  secret: string,
  now = Date.now()
) {
  if (!cookieValue) {
    return { ok: false as const };
  }

  const [body, signature] = cookieValue.split(".");

  if (!body || !signature) {
    return { ok: false as const };
  }

  const expected = base64UrlEncode(await hmacSha256(body, secret));

  if (!safeEqual(signature, expected)) {
    return { ok: false as const };
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as Partial<SignedSessionPayload>;

    if (
      typeof parsed.subject !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= now
    ) {
      return { ok: false as const };
    }

    return {
      ok: true as const,
      session: {
        subject: parsed.subject,
        username: parsed.username,
        source: parsed.source as AdminSessionSource
      }
    };
  } catch {
    return { ok: false as const };
  }
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  };
}

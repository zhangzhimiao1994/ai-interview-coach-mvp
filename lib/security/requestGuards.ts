export const productionPlaceholder = "change-this-before-production";

type AuthConfig = {
  username: string;
  password: string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export function isPlaceholderSecret(value: string | undefined) {
  return !value || value.trim() === "" || value.trim() === productionPlaceholder;
}

export function isProtectedPath(pathname: string) {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/practice/")
  );
}

export function authenticateBasicRequest(authorization: string | null, config: AuthConfig) {
  if (!authorization?.startsWith("Basic ")) {
    return { ok: false };
  }

  try {
    const encoded = authorization.slice("Basic ".length);
    const decoded =
      typeof atob === "function" ? atob(encoded) : Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return { ok: false };
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    return { ok: username === config.username && password === config.password };
  } catch {
    return { ok: false };
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export function resetRateLimits() {
  buckets.clear();
}

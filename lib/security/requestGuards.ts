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
const pruneIntervalMs = 60_000;
let nextPruneAt = 0;

export function isPlaceholderSecret(value: string | undefined) {
  return !value || value.trim() === "" || value.trim() === productionPlaceholder;
}

export function isProtectedPath(pathname: string) {
  if (pathname === "/api/health") {
    return false;
  }

  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/practice/")
  );
}

export function isCandidateEntryPath(pathname: string, method: string) {
  return pathname.startsWith("/practice/") ||
    (method === "POST" && pathname === "/api/sessions");
}

export function isCandidateApiPath(pathname: string, trainingSessionId: string) {
  if (pathname === "/api/digital-human/renders" || pathname.startsWith("/api/digital-human/renders/")) {
    return true;
  }
  return pathname === `/api/sessions/${trainingSessionId}/answer` ||
    pathname === `/api/sessions/${trainingSessionId}/complete`;
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
  if (now >= nextPruneAt) {
    pruneExpiredRateLimits(now);
    nextPruneAt = now + pruneIntervalMs;
  }

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

export function pruneExpiredRateLimits(now = Date.now()) {
  let removed = 0;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
      removed += 1;
    }
  }

  return removed;
}

export function resetRateLimits() {
  buckets.clear();
  nextPruneAt = 0;
}

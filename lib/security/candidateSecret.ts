export function readCandidateSessionSecret(
  env: Record<string, string | undefined> = process.env
) {
  const secret = env.AI_CONFIG_SECRET?.trim() ?? "";
  assertCandidateSessionSecret(secret);
  return secret;
}

export function assertCandidateSessionSecret(secret: string) {
  const trimmed = secret.trim();
  const normalized = trimmed.toLowerCase();
  const placeholder =
    normalized === "change-this-before-production" ||
    normalized === "development-ai-config-secret-change-me" ||
    normalized.includes("your-secret") ||
    trimmed.includes("换成一个足够长的随机字符串");
  if (trimmed.length < 32 || placeholder || new Set(trimmed).size < 8) {
    throw new Error("CANDIDATE_SESSION_SECRET_INVALID");
  }
}

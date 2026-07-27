import { createHash } from "node:crypto";

const trackingQueryNames = new Set(["gh_src", "lever-source"]);

export function normalizeRecruitmentText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function canonicalizeJobUrl(value: string) {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);
    url.hash = "";

    for (const key of Array.from(url.searchParams.keys())) {
      if (trackingQueryNames.has(key) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch {
    return trimmed;
  }
}

export function hashRecruitmentContent(value: string) {
  return createHash("sha256").update(normalizeRecruitmentText(value)).digest("hex");
}

export function buildRecruitmentDedupeKey(input: {
  provider: string;
  externalJobId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  company?: string | null;
  description?: string | null;
}) {
  const provider = normalizeRecruitmentText(input.provider).toLowerCase();
  const externalJobId = input.externalJobId?.trim();

  if (externalJobId) {
    return `provider:${provider}:${externalJobId}`;
  }

  if (input.sourceUrl?.trim()) {
    return `url:${canonicalizeJobUrl(input.sourceUrl)}`;
  }

  return `hash:${hashRecruitmentContent(
    [input.title, input.company, input.description].map((value) => value?.trim() || "").join("\n")
  )}`;
}

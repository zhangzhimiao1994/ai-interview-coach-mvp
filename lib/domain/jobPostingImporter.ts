export type JobPostingImportResult = {
  title?: string;
  company?: string;
  description: string;
  requirements: string[];
  sourceUrl?: string;
};

const blockedPagePatterns = [
  /请先登录/,
  /登录后查看/,
  /安全验证/,
  /滑块验证/,
  /验证码/,
  /captcha/i,
  /sign in to view/i,
  /login to view/i,
  /verify you are human/i,
  /access denied/i,
  /unusual traffic/i
];

const privateHostPatterns = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/i
];

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html: string) {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h[1-6]|li|ul|ol)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n\s*-\s*/g, "\n- ")
  );
}

function firstMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1] ? normalizeText(stripHtml(match[1])) : undefined;
}

function extractMeta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i")
  );
}

function extractRequirements(description: string) {
  return description
    .split(/\n+/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter((line) =>
      /要求|任职|加分|熟悉|经验|负责|职责|requirements?|qualifications?|responsibilit(?:y|ies)|experience|preferred|must|partner|define/i.test(
        line
      )
    )
    .slice(0, 20);
}

function extractCompany(html: string) {
  return (
    extractMeta(html, "og:site_name") ||
    firstMatch(html, /<[^>]+class=["'][^"']*(?:company|company-name|org|organization)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
  );
}

export function isBlockedJobPostingHtml(html: string) {
  const text = stripHtml(html);
  return blockedPagePatterns.some((pattern) => pattern.test(text));
}

export function isSafePublicJobPostingUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return !privateHostPatterns.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

export function extractJobPostingFromHtml(html: string, sourceUrl?: string): JobPostingImportResult {
  const title =
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    extractMeta(html, "og:title") ||
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const company = extractCompany(html);
  const description = stripHtml(html);

  return {
    title,
    company,
    description,
    requirements: extractRequirements(description),
    sourceUrl
  };
}

export function buildJobDescriptionContext(input: {
  importedDescription?: string | null;
  manualNotes?: string | null;
}) {
  const parts = [
    input.importedDescription?.trim(),
    input.manualNotes?.trim() ? `人工补充：\n${input.manualNotes.trim()}` : undefined
  ].filter(Boolean);

  return parts.join("\n\n");
}

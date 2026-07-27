export function stripHtml(value?: string | null) {
  return (value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function parseDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function hasKeywordMatch(text: string, keywords: string) {
  const tokens = keywords
    .toLowerCase()
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);

  if (tokens.length === 0) return true;

  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

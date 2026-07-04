export function parseJsonList(value: string): unknown[];
export function parseJsonList<T>(value: string, isItem: (item: unknown) => item is T): T[];
export function parseJsonList<T>(value: string, isItem?: (item: unknown) => item is T): unknown[] | T[] {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    if (isItem && !parsed.every(isItem)) {
      return [];
    }

    return isItem ? (parsed as T[]) : parsed;
  } catch {
    return [];
  }
}

export function parseJsonStringList(value: string): string[] {
  return parseJsonList(value, (item): item is string => typeof item === "string");
}

export function getTopWeakTags(tags: string[], limit = 3): string[] {
  const normalizedLimit = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));

  return tags.slice(0, normalizedLimit);
}

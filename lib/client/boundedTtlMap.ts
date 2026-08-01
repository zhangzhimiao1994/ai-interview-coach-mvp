export class BoundedTtlMap<Key, Value> {
  private readonly entries = new Map<Key, { value: Value; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("BOUNDED_TTL_MAP_INVALID_LIMIT");
    }
  }

  get size() {
    this.pruneExpired();
    return this.entries.size;
  }

  get(key: Key): Value | undefined {
    this.pruneExpired();
    return this.entries.get(key)?.value;
  }

  set(key: Key, value: Value) {
    this.pruneExpired();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: Key) {
    return this.entries.delete(key);
  }

  private pruneExpired() {
    const observedAt = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= observedAt) this.entries.delete(key);
    }
  }
}

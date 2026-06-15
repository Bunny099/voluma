interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TTLCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly pending = new Map<K, Promise<V>>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxSize = 1_000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.defaultTtlMs): V {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    this.prune();
    return value;
  }

  delete(key: K): void {
    this.entries.delete(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  async getOrSet(
    key: K,
    factory: () => Promise<V>,
    ttlMs = this.defaultTtlMs,
  ): Promise<V> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const pending = this.pending.get(key);
    if (pending) return pending;

    const task = factory()
      .then((value) => this.set(key, value, ttlMs))
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, task);
    return task;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    if (this.entries.size <= this.maxSize) return;

    const overflow = this.entries.size - this.maxSize;
    const keys = [...this.entries.keys()];
    for (const key of keys.slice(0, overflow)) {
      this.entries.delete(key);
    }
  }
}

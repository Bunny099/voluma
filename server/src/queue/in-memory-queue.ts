
export class EventQueue<T> {
  private readonly queue: T[] = [];
  private active = 0;

  constructor(
    private readonly handler:     (item: T) => Promise<void>,
    private readonly maxSize:     number = 5_000,
    private readonly concurrency: number = 20,
  ) {}

  /** Returns true if enqueued, false if dropped. */
  push(item: T): boolean {
    if (this.queue.length >= this.maxSize) return false;
    this.queue.push(item);
    this.drain();
    return true;
  }

  get depth():      number { return this.queue.length; }
  get inFlight():   number { return this.active;       }

  // ─── Internal ───────────────────────────────────────────────────────────

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.handler(item)
        .catch(e => console.error('[Queue]', (e as Error).message))
        .finally(() => { this.active--; this.drain(); });
    }
  }
}
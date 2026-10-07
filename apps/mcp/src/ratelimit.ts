// Per-user token bucket for tool calls (in memory, per process). It sits in
// front of the API's own per-IP and per-user limits so one runaway agent
// cannot burn through them for everyone sharing the same address.

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly maxTracked = 10_000
  ) {}

  // True if the call may proceed. perMinute = 0 disables limiting.
  take(key: string): boolean {
    if (this.perMinute <= 0) return true;
    const t = this.now();
    const refillPerMs = this.perMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, updated: t };
    b.tokens = Math.min(this.perMinute, b.tokens + (t - b.updated) * refillPerMs);
    b.updated = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.delete(key); // re-insert to keep Map order ~LRU
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxTracked) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    return true;
  }
}

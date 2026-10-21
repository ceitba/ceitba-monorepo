// Port of apps/api/src/main/java/org/ceitba/api/external/llm/DoQuotaTracker.java.
//
// Latest DigitalOcean rate-limit counters, read from the x-ratelimit-limit-* /
// x-ratelimit-remaining-* headers of every DO response (429s included), kept
// in memory only. Keys are the header suffix: batch-creations-per-hour,
// batch-create-per-minute, batch-requests-per-day, batch-status-checks-per-minute,
// tokens-per-day, tokens-per-minute, requests. x-ratelimit-reset-* is a Unix
// time when DO knows it (0 otherwise). No probe is bound in production
// (refreshBatchQuota() is a no-op unless a test binds one).
//
// Rejected creation attempts count against batch-creations-per-hour, so once
// the quota is 0 nothing calls POST /v1/batches (not even the probe) until DO's
// reset time, or an hour after the observation when DO gives none.
// One instance per process (createLlmClients in src/external/llm.ts), fed by the DO HTTP clients.

import { jTrim } from '../javaString';
import { Odt, type Now } from '../odt';

export const BATCH_CREATIONS_HOUR = 'batch-creations-per-hour';
export const TOKENS_DAY = 'tokens-per-day';

/** Sync daily-token pauses re-check this often (no reset header to rely on). */
export const DAILY_RETRY_SEC = 30 * 60;
export const BATCH_WINDOW_SEC = 60 * 60;
export const RESET_MARGIN_SEC = 30;
export const PROBE_EVERY_SEC = 60;

/** resetAt: DO's x-ratelimit-reset-* time, null when DO sent 0 or nothing. */
export interface Counter {
  limit: number | null;
  remaining: number | null;
  observedAt: Odt;
  resetAt: Odt | null;
}

export interface BatchWait {
  until: Odt;
  reason: string;
}

/** Response headers: a fetch Headers, or name -> value(s). */
export type HeaderSource = Headers | Record<string, string | readonly string[] | undefined>;

export class DoQuotaTracker {
  private readonly counters = new Map<string, Counter>();
  private observedAt: Odt | null = null;
  private retryAfterSec: number | null = null;
  private lastProbe: Odt | null = null;
  private probe: () => unknown = () => {};

  constructor(private readonly now: Now) {}

  /** The batch client's free probe; the config binds it. */
  bindProbe(probe: () => unknown): void {
    this.probe = probe;
  }

  /** Header names are matched case-insensitively. */
  observe(headers: HeaderSource): void {
    const now = this.now();
    const limits = new Map<string, number | null>();
    const remaining = new Map<string, number | null>();
    const resets = new Map<string, number | null>();
    let any = false;
    for (const [rawName, value] of entries(headers)) {
      const name = rawName.toLowerCase();
      if (value == null) continue;
      if (name.startsWith('x-ratelimit-limit-')) {
        limits.set(name.substring('x-ratelimit-limit-'.length), number(value));
      } else if (name.startsWith('x-ratelimit-remaining-')) {
        remaining.set(name.substring('x-ratelimit-remaining-'.length), number(value));
      } else if (name.startsWith('x-ratelimit-reset-')) {
        resets.set(name.substring('x-ratelimit-reset-'.length), number(value));
      } else if (name === 'retry-after') {
        const s = number(value);
        if (s != null) this.retryAfterSec = s;
      }
    }
    const keys = new Set([...limits.keys(), ...remaining.keys()]);
    for (const k of keys) {
      const prev = this.counters.get(k);
      const limit = limits.get(k) != null ? limits.get(k)! : prev == null ? null : prev.limit;
      const rem = remaining.get(k) != null ? remaining.get(k)! : prev == null ? null : prev.remaining;
      const r = resets.get(k);
      const resetAt = r == null || r <= 0 ? null : Odt.ofEpoch(r, 0, 0);
      this.counters.set(k, { limit, remaining: rem, observedAt: now, resetAt });
      any = true;
    }
    if (any) this.observedAt = now;
  }

  counter(key: string): Counter | null {
    return this.counters.get(key) ?? null;
  }

  lastObservedAt(): Odt | null {
    return this.observedAt;
  }

  lastRetryAfterSeconds(): number | null {
    return this.retryAfterSec;
  }

  /** Batch probe; at most once a minute, never throws, never while a zero quota waits for its reset. */
  async refreshBatchQuota(): Promise<void> {
    const now = this.now();
    if (this.lastProbe != null && now.isBefore(this.lastProbe.plusSeconds(PROBE_EVERY_SEC))) return;
    const zero = this.zeroUntil();
    if (zero != null && now.isBefore(zero)) return;
    this.lastProbe = now;
    try {
      await this.probe();
    } catch {
      // a failed probe leaves the snapshot as it was
    }
  }

  /**
   * Present while the last snapshot says no batch creation is left: until DO's
   * reset time (plus a margin), or observedAt + 60 min when DO gave none.
   */
  batchCreationWait(): BatchWait | null {
    const c = this.counters.get(BATCH_CREATIONS_HOUR);
    const until = this.zeroUntil();
    if (c == null || until == null || !this.now().isBefore(until)) return null;
    return { until, reason: `Esperando cupo de lotes de DigitalOcean: 0/${c.limit == null ? '?' : c.limit} esta hora` };
  }

  /** When a zero hourly batch quota frees up, if the last snapshot is zero. */
  zeroUntil(): Odt | null {
    const c = this.counters.get(BATCH_CREATIONS_HOUR);
    if (c == null || c.remaining == null || c.remaining > 0) return null;
    return c.resetAt != null && c.resetAt.isAfter(c.observedAt)
      ? c.resetAt.plusSeconds(RESET_MARGIN_SEC)
      : c.observedAt.plusSeconds(BATCH_WINDOW_SEC);
  }

  /**
   * The snapshot (under 30 min old) shows fewer daily tokens left than the next
   * request needs. An older snapshot is ignored.
   */
  dailyTokensShort(estimatedTokens: number): boolean {
    const c = this.counters.get(TOKENS_DAY);
    if (c == null || c.remaining == null) return false;
    if (!this.now().isBefore(c.observedAt.plusSeconds(DAILY_RETRY_SEC))) return false;
    return c.remaining < estimatedTokens;
  }
}

function entries(h: HeaderSource): [string, string | null][] {
  if (typeof Headers !== 'undefined' && h instanceof Headers) return [...h.entries()];
  return Object.entries(h as Record<string, string | readonly string[] | undefined>).map(([k, v]) => [
    k,
    v == null ? null : typeof v === 'string' ? v : (v[0] ?? null),
  ]);
}

// Long.parseLong(v.trim()): optional sign, digits, within long range; else null.
function number(v: string): number | null {
  const t = jTrim(v);
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = BigInt(t);
  if (n > 9223372036854775807n || n < -9223372036854775808n) return null;
  return Number(n);
}

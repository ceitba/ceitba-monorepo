// Rate limiting: web/ratelimit/RateLimitFilter + ClientIp, service/ratelimit/UserRateLimiter,
// config/RateLimitProperties. In-memory token buckets (bucket4j greedy refill:
// capacity per period, refilled continuously), per instance, LRU-bounded.

import { LRUCache } from 'lru-cache';
import type { RateLimitConfig, RateLimitRule } from '../config/sections/rateLimit';
import { RateLimitExceededError } from './errors';
import { matchesPattern } from './auth/policy';

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private readonly capacity: number, private readonly periodMs: number, now: number) {
    this.tokens = capacity;
    this.last = now;
  }
  private refill(now: number) {
    if (now > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) * this.capacity) / this.periodMs);
      this.last = now;
    }
  }
  /** bucket4j tryConsumeAndReturnRemaining(1). */
  tryConsume(now: number): { consumed: boolean; remaining: number; waitMs: number } {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { consumed: true, remaining: Math.floor(this.tokens), waitMs: 0 };
    }
    return { consumed: false, remaining: 0, waitMs: ((1 - this.tokens) * this.periodMs) / this.capacity };
  }
}

/** ceil(nanosToWaitForRefill / 1s), at least 1. */
export const retryAfterSeconds = (waitMs: number) => Math.max(1, Math.ceil(waitMs / 1000 - 1e-9));

// ------------------------------------------------------------------ client ip

function ipv4Parts(addr: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((x) => x <= 255) ? p : null;
}

/** 16 bytes of an IPv6 literal (handles ::, embedded IPv4, zone ids), or null. */
export function ipv6Bytes(addr: string): number[] | null {
  let a = addr;
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (!a.includes(':')) return null;
  let tail: number[] = [];
  const lastColon = a.lastIndexOf(':');
  const maybeV4 = a.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = ipv4Parts(maybeV4);
    if (!v4) return null;
    tail = v4;
    a = `${a.slice(0, lastColon + 1)}0:0`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === '' ? [] : s.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  const bytes = groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

/** ClientIp.isPrivatePeer: loopback, site-local, link-local or fc00::/7 (never a DNS lookup). */
export function isPrivatePeer(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const v4 = ipv4Parts(addr);
  if (v4) {
    const [a, b] = v4 as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (!addr.includes(':')) return false;
  const b = ipv6Bytes(addr);
  if (!b) return false;
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255;
  if (mapped) return isPrivatePeer(b.slice(12).join('.'));
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true; // fec0::/10 site-local
  return (b[0]! & 0xfe) === 0xfc; // fc00::/7
}

/**
 * ClientIp.resolve: the right-most X-Forwarded-For entry when trusted and the
 * direct peer is private (our proxy); otherwise the peer address.
 */
export function resolveClientIp(remoteAddr: string, xff: string | null | undefined, trustForwardedFor: boolean): string {
  if (trustForwardedFor && isPrivatePeer(remoteAddr) && xff && xff.trim() !== '') {
    const parts = xff.split(',');
    const last = parts[parts.length - 1]!.trim();
    if (last !== '') return last;
  }
  return remoteAddr;
}

/** Java InetAddress.getHostAddress of 16 bytes: groups without leading zeros, no :: compression. */
function javaIpv6String(b: number[]): string {
  const g: string[] = [];
  for (let i = 0; i < 16; i += 2) g.push(((b[i]! << 8) | b[i + 1]!).toString(16));
  return g.join(':');
}

/** RateLimitFilter.clientKey: IPv6 -> its /64 prefix, IPv4 (incl. mapped) -> the address. */
export function clientKey(addr: string): string {
  if (!addr || !addr.includes(':')) return addr;
  const b = ipv6Bytes(addr);
  if (!b) return addr;
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255;
  if (mapped) return b.slice(12).join('.');
  return `${javaIpv6String([...b.slice(0, 8), 0, 0, 0, 0, 0, 0, 0, 0])}/64`;
}

// ------------------------------------------------------------------ per-IP filter

export interface RateLimitDecision {
  rule: RateLimitRule;
  headers: Record<string, string>;
  /** Set when the request is rejected. */
  rejected?: { retryAfterSeconds: number };
}

export class IpRateLimiter {
  private readonly buckets: LRUCache<string, TokenBucket>;
  constructor(private readonly cfg: RateLimitConfig, private readonly nowMs: () => number = () => performance.timeOrigin + performance.now()) {
    const idle = Math.max(60_000, ...cfg.rules.map((r) => r.periodMs));
    this.buckets = new LRUCache({ max: cfg.maxTrackedClients, ttl: idle, updateAgeOnGet: true });
  }

  private match(method: string, rawPath: string): RateLimitRule | null {
    for (const rule of this.cfg.rules) {
      if (rule.methods.length && !rule.methods.includes(method.toUpperCase())) continue;
      if (rule.paths.some((p) => matchesPattern(p, rawPath)) && !rule.excludePaths.some((p) => matchesPattern(p, rawPath))) return rule;
    }
    return null;
  }

  /** null when the request is not limited (disabled, no rule, OPTIONS). `rawPath`: raw URI inside /api. */
  check(method: string, rawPath: string, clientIp: string): RateLimitDecision | null {
    if (!this.cfg.enabled || this.cfg.rules.length === 0 || method.toUpperCase() === 'OPTIONS') return null;
    const rule = this.match(method, rawPath);
    if (!rule) return null;
    const key = `${rule.name}|${clientKey(clientIp)}`;
    let bucket = this.buckets.get(key);
    const now = this.nowMs();
    if (!bucket) {
      bucket = new TokenBucket(rule.capacity, rule.periodMs, now);
      this.buckets.set(key, bucket);
    }
    const probe = bucket.tryConsume(now);
    if (probe.consumed) {
      return { rule, headers: { 'X-RateLimit-Limit': String(rule.capacity), 'X-RateLimit-Remaining': String(probe.remaining) } };
    }
    const retry = retryAfterSeconds(probe.waitMs);
    return {
      rule,
      headers: { 'Retry-After': String(retry), 'X-RateLimit-Limit': String(rule.capacity), 'X-RateLimit-Remaining': '0' },
      rejected: { retryAfterSeconds: retry },
    };
  }
}

/** service/ratelimit/UserRateLimiter: per-user quotas for rate-limit.user-rules.<rule>. */
export class UserRateLimiter {
  private readonly buckets: LRUCache<string, TokenBucket>;
  constructor(private readonly cfg: RateLimitConfig, private readonly nowMs: () => number = () => performance.timeOrigin + performance.now()) {
    const idle = Math.max(60_000, ...Object.values(cfg.userRules).map((r) => r.periodMs));
    this.buckets = new LRUCache({ max: cfg.maxTrackedClients, ttl: idle, updateAgeOnGet: true });
  }

  /** Takes one token or throws RateLimitExceededError. Unknown rule or disabled = no limit. */
  consume(rule: string, userId: string): void {
    if (!this.cfg.enabled) return;
    const c = this.cfg.userRules[rule];
    if (!c) return;
    const key = `${rule}|${userId}`;
    const now = this.nowMs();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(c.capacity, c.periodMs, now);
      this.buckets.set(key, bucket);
    }
    const probe = bucket.tryConsume(now);
    if (!probe.consumed) throw new RateLimitExceededError(retryAfterSeconds(probe.waitMs));
  }
}

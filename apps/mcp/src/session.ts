import { ApiError, type CeitbaApi } from "./api/client";
import type { UserMe } from "./api/types";
import type { Lang } from "./config";
import { identityFrom, type Identity } from "./context";

// Looks up who a credential belongs to. null for anonymous sessions; throws
// for credentials the API rejects (expired/revoked key, non-allowlisted user).
export async function resolveIdentity(api: CeitbaApi, fallbackLang: Lang): Promise<Identity | null> {
  if (!api.authenticated) return null;
  const me = await api.get<UserMe>("/v1/auth/me");
  return identityFrom(me, fallbackLang);
}

// Small TTL cache of identities per credential (keyed by a hash, never the
// raw secret), so stateless HTTP requests don't call /auth/me every time.
export class IdentityCache {
  private readonly entries = new Map<string, { identity: Identity; at: number }>();

  constructor(private readonly ttlMs = 5 * 60_000, private readonly now: () => number = Date.now, private readonly max = 5_000) {}

  async get(key: string, load: () => Promise<Identity | null>): Promise<Identity | null> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.identity;
    const identity = await load();
    if (identity) {
      this.entries.set(key, { identity, at: this.now() });
      if (this.entries.size > this.max) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    }
    return identity;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

export const isAuthRejection = (e: unknown): boolean =>
  e instanceof ApiError && (e.status === 401 || e.status === 403);

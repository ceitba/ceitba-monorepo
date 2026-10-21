// service/capability/CapabilityService + CapabilityAdminService.
//
// Other features gate on a capability with:
//   import { CapabilityService } from '../capability/service';
//   await new CapabilityService(deps).require(user, 'apuntes');   // 403 CAPABILITY_REQUIRED
// (effective rule in src/shared/capabilities.ts: active STAFF, enabled_for_all,
// a grant on the email, a grant on one of the user's organizations).

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { CapabilityRequiredError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { formatOffsetDateTime, parsePgTimestamp, toPgTimestamp } from '../../lib/time';
import { javaTrim } from '../../lib/javaCompat';
import { CAPABILITIES, capabilitiesForEveryone, effectiveCapabilities, type CapabilityKey } from '../../shared/capabilities';
import type { CapabilityGrantsResponse, CapabilityResponse } from './dto';
import * as repo from './repo';

export type Capability = (typeof CAPABILITIES)[number];
export { CAPABILITIES, type CapabilityKey };

/** Capability.fromKey. */
export function capabilityFromKey(key: string | null | undefined): Capability | null {
  return CAPABILITIES.find((c) => c.key === key) ?? null;
}

// "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" with Java's ASCII \s ([ \t\n\x0B\f\r]).
const JAVA_EMAIL = /^[^@ \t\n\x0B\f\r]+@[^@ \t\n\x0B\f\r]+\.[^@ \t\n\x0B\f\r]+$/;

type UserLike = { id: string; email: string | null };

export class CapabilityService {
  constructor(private readonly deps: Pick<Deps, 'db' | 'clock'>) {}

  /** Sorted effective keys of `user` (null -> none). */
  effective(user: UserLike | null, db: Db = this.deps.db): Promise<string[]> {
    return withTx(db, (tx) => effectiveCapabilities(tx, user, this.deps.clock.now()), { readOnly: true });
  }

  /** Keys switched on for everyone, sorted. */
  enabledForAll(db: Db = this.deps.db): Promise<string[]> {
    return withTx(db, (tx) => capabilitiesForEveryone(tx), { readOnly: true });
  }

  async has(user: UserLike | null, capability: CapabilityKey, db?: Db): Promise<boolean> {
    return (await this.effective(user, db)).includes(capability);
  }

  /** CapabilityRequiredException -> 403 CAPABILITY_REQUIRED. */
  async require(user: UserLike | null, capability: CapabilityKey, db?: Db): Promise<void> {
    if (!(await this.has(user, capability, db))) throw new CapabilityRequiredError(capability);
  }

  /** Of `users`, the ids of those holding `capability` (weekly digest batches). */
  holders(capability: CapabilityKey, users: UserLike[], db: Db = this.deps.db): Promise<Set<string>> {
    return withTx(db, async (tx) => {
      if (users.length === 0) return new Set<string>();
      const ids = new Set(users.map((u) => u.id));
      if ((await repo.findEnabledForAll(tx)).includes(capability)) return ids;
      const out = new Set<string>();
      for (const s of await repo.activeStaffIds(tx, toPgTimestamp(this.deps.clock.now()))) if (ids.has(s)) out.add(s);
      const granted = new Set((await repo.userGrantsOf(tx, capability)).map((g) => g.email.toLowerCase()));
      for (const u of users) if (u.email != null && granted.has(u.email.toLowerCase())) out.add(u.id);
      for (const id of await repo.membersWithCapability(tx, capability, [...ids])) out.add(id);
      return out;
    }, { readOnly: true });
  }
}

/** CapabilityAdminService: STAFF management under /v1/staff/capabilities. */
export class CapabilityAdminService {
  constructor(private readonly deps: Pick<Deps, 'db' | 'clock'>) {}

  list(): Promise<CapabilityResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const out: CapabilityResponse[] = [];
      for (const c of CAPABILITIES) out.push(await this.describe(tx, c));
      return out;
    }, { readOnly: true });
  }

  setEnabledForAll(key: string, enabled: boolean, by: string | null): Promise<CapabilityResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = resolve(key);
      await repo.upsertSetting(tx, c.key, enabled, by, this.nowPg());
      return this.describe(tx, c);
    });
  }

  grants(key: string, db: Db = this.deps.db): Promise<CapabilityGrantsResponse> {
    return withTx(db, async (tx) => {
      const c = resolve(key);
      const ug = await repo.userGrantsOf(tx, c.key);
      const og = await repo.orgGrantsOf(tx, c.key);
      const granterIds = new Set<string>();
      for (const g of ug) if (g.grantedBy != null) granterIds.add(g.grantedBy);
      for (const g of og) if (g.grantedBy != null) granterIds.add(g.grantedBy);
      const granters = new Map((await repo.usersByIds(tx, [...granterIds])).map((u) => [u.id, u]));
      const byEmail = new Map<string, { id: string; name: string | null }>();
      if (ug.length > 0) {
        // Collectors.toMap(..., (a, b) -> a): the first user with that lower-cased email wins.
        for (const u of await repo.usersByLowerEmails(tx, ug.map((g) => g.email))) {
          const k = u.email.toLowerCase();
          if (!byEmail.has(k)) byEmail.set(k, u);
        }
      }
      const orgs = new Map((await repo.orgsBySlugs(tx, og.map((g) => g.orgSlug))).map((o) => [o.slug, o]));
      const nameOf = (id: string | null) => (id == null ? null : granters.get(id)?.name ?? null);
      const users = ug.map((g) => {
        const u = byEmail.get(g.email);
        return {
          email: g.email, userId: u?.id ?? null, name: u?.name ?? null,
          grantedAt: formatOffsetDateTime(parsePgTimestamp(g.grantedAt)), grantedByName: nameOf(g.grantedBy),
        };
      });
      const orgItems = [];
      for (const g of og) {
        orgItems.push({
          slug: g.orgSlug, name: orgs.get(g.orgSlug)?.name ?? null, memberCount: await repo.countMembers(tx, g.orgSlug),
          grantedAt: formatOffsetDateTime(parsePgTimestamp(g.grantedAt)), grantedByName: nameOf(g.grantedBy),
        });
      }
      return { users, orgs: orgItems };
    }, { readOnly: true });
  }

  grantUsers(key: string, emails: (string | null)[], by: string | null): Promise<CapabilityGrantsResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = resolve(key);
      const normalized = new Set<string>();
      for (const raw of emails) {
        const email = raw == null ? '' : javaTrim(raw).toLowerCase();
        if (email.length > 320 || !JAVA_EMAIL.test(email)) throw new ValidationError('emails', raw, 'is not a valid email');
        normalized.add(email);
      }
      const at = this.nowPg();
      for (const email of normalized) await repo.insertUserGrantIfAbsent(tx, c.key, email, at, by);
      return this.grants(key, tx);
    });
  }

  revokeUser(key: string, email: string): Promise<CapabilityGrantsResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = resolve(key);
      await repo.deleteUserGrant(tx, c.key, javaTrim(email).toLowerCase());
      return this.grants(key, tx);
    });
  }

  grantOrg(key: string, slug: string, by: string | null): Promise<CapabilityGrantsResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = resolve(key);
      if (!(await repo.orgExists(tx, slug))) throw new ResourceNotFoundError('Organization', slug);
      await repo.insertOrgGrantIfAbsent(tx, c.key, slug, this.nowPg(), by);
      return this.grants(key, tx);
    });
  }

  revokeOrg(key: string, slug: string): Promise<CapabilityGrantsResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = resolve(key);
      await repo.deleteOrgGrant(tx, c.key, slug);
      return this.grants(key, tx);
    });
  }

  private async describe(db: Db, c: Capability): Promise<CapabilityResponse> {
    const all = (await repo.findSetting(db, c.key))?.enabledForAll ?? false;
    return {
      key: c.key, label: c.label, description: c.description, enabledForAll: all,
      userGrantCount: await repo.countUserGrants(db, c.key), orgGrantCount: await repo.countOrgGrants(db, c.key),
    };
  }

  /** OffsetDateTime.now(clock) in UTC, truncated to micros. */
  private nowPg(): string {
    return toPgTimestamp(this.deps.clock.now());
  }
}

function resolve(key: string): Capability {
  const c = capabilityFromKey(key);
  if (!c) throw new ResourceNotFoundError('Capability', key);
  return c;
}

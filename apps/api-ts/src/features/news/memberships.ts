// service/news/OrganizationMembershipService. Exported for the other features
// that use it in Java (web/user/MeOrganizationsController, UserMembershipsController,
// provisioning's claimInvites, account deletion's requireNotLastAdmin).

import type { Db } from '../../db/client';
import { isUniqueViolation, withTx } from '../../db/client';
import type { Deps } from '../../deps';
import { admits } from '../../http/auth/allowlist';
import { InvalidStateError, LastOrgAdminError, ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, type Micros } from '../../lib/time';
import type { BoardMemberView, InviteResult, InviteView, MemberSettings, MemberView } from './dto';
import { firePushes, type PushTrigger } from './pushTriggers';
import { pushMessage } from '../push/service';
import * as repo from './repo';

export const ADMIN_ROLE = 'admin';
export const MEMBER_ROLE = 'member';
export const ROLES = [MEMBER_ROLE, ADMIN_ROLE] as const;
const MAX_INVITES_PER_REQUEST = 50;
const MAX_TITLE_LENGTH = 60;
const EMAIL = /^[^@ \t\n\x0B\f\r]+@[^@ \t\n\x0B\f\r]+\.[^@ \t\n\x0B\f\r]+$/;

/** A DB timestamp as Hibernate reads it (UTC). */
export const dbTime = (pg: string | null | undefined): string | null => (pg == null ? null : formatOffsetDateTime(parsePgTimestamp(pg)));

/** Locale.ROOT lower-casing of an email (ASCII + simple folding, like Java). */
const lowerRoot = (s: string) => s.toLowerCase();

function requireValidRole(role: string | null): string {
  if (role === null || !(ROLES as readonly string[]).includes(role)) {
    throw new ValidationError('role', role, `must be one of [${ROLES.join(', ')}]`);
  }
  return role;
}

/** Java String.compareTo (UTF-16 code units). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class OrganizationMembershipService {
  constructor(private readonly deps: Deps) {}

  private db(tx?: Db): Db {
    return tx ?? this.deps.db;
  }

  /** listForUser */
  listForUser(userId: string, tx?: Db) {
    return repo.membershipsOfUser(this.db(tx), userId);
  }

  async userBelongsTo(userId: string | null, org: string | null, tx?: Db): Promise<boolean> {
    if (userId === null || org === null) return false;
    return repo.membershipExists(this.db(tx), userId, org);
  }

  async userIsAdminOf(userId: string | null, org: string | null, tx?: Db): Promise<boolean> {
    if (userId === null || org === null) return false;
    return repo.membershipExists(this.db(tx), userId, org, ADMIN_ROLE);
  }

  async userSeesAttendeesOf(userId: string | null, org: string | null, tx?: Db): Promise<boolean> {
    if (userId === null || org === null) return false;
    const db = this.db(tx);
    const m = await repo.findMembership(db, userId, org);
    if (!m) return false;
    if (m.role === ADMIN_ROLE) return true;
    return (await repo.findOrg(db, org))?.attendeesVisibleToMembers ?? false;
  }

  private async requireOrg(db: Db, org: string) {
    const o = await repo.findOrg(db, org);
    if (!o) throw new ResourceNotFoundError('Organization', org);
    return o;
  }

  private async usersById(db: Db, ids: string[]) {
    return new Map((await repo.findUsersByIds(db, ids)).map((u) => [u.id, u]));
  }

  private static view(m: repo.MembershipRow, u: repo.UserRow | undefined | null, since: string | null): MemberView {
    return { userId: m.userId, name: u?.name ?? null, email: u?.email ?? null, avatarUrl: u?.avatarUrl ?? null,
      role: m.role, title: m.title, showOnPortal: m.showOnPortal, since };
  }

  /** members: admins first, then by lower-cased name. */
  members(org: string): Promise<MemberView[]> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireOrg(tx, org);
      const ms = await repo.membershipsOfOrg(tx, org);
      const byId = await this.usersById(tx, ms.map((m) => m.userId));
      const views = ms.map((m) => OrganizationMembershipService.view(m, byId.get(m.userId), dbTime(m.createdAt)));
      const key = (v: MemberView) => (v.name === null ? '' : v.name.toLowerCase());
      return views.sort((a, b) => Number(a.role !== ADMIN_ROLE) - Number(b.role !== ADMIN_ROLE) || cmp(key(a), key(b)));
    }, { readOnly: true });
  }

  settings(org: string): Promise<MemberSettings> {
    return withTx(this.deps.db, async (tx) => ({ attendeesVisibleToMembers: (await this.requireOrg(tx, org)).attendeesVisibleToMembers }), { readOnly: true });
  }

  updateSettings(org: string, attendeesVisibleToMembers: boolean | null): Promise<MemberSettings> {
    return withTx(this.deps.db, async (tx) => {
      const o = await this.requireOrg(tx, org);
      if (attendeesVisibleToMembers !== null && attendeesVisibleToMembers !== o.attendeesVisibleToMembers) {
        await repo.updateOrg(tx, org, { attendeesVisibleToMembers });
        return { attendeesVisibleToMembers };
      }
      return { attendeesVisibleToMembers: o.attendeesVisibleToMembers };
    });
  }

  invites(org: string): Promise<InviteView[]> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireOrg(tx, org);
      return (await repo.invitesOfOrg(tx, org)).map((i) => ({ email: i.email, role: i.role, createdAt: dbTime(i.createdAt)! }));
    }, { readOnly: true });
  }

  /** Public board: members who opted in, oldest first, no emails. */
  board(org: string, tx?: Db): Promise<BoardMemberView[]> {
    return withTx(this.db(tx), async (t) => {
      const ms = await repo.boardOf(t, org);
      const byId = await this.usersById(t, ms.map((m) => m.userId));
      return ms.filter((m) => byId.has(m.userId)).map((m) => {
        const u = byId.get(m.userId)!;
        return { name: u.name, title: m.title, avatarUrl: u.avatarUrl };
      });
    }, { readOnly: true });
  }

  /**
   * add (STAFF, UserMembershipsController): returns the membership row as
   * Hibernate's save() leaves it (createdAt null: merge of assigned ids).
   */
  async add(userId: string, org: string, role: string | null, addedBy: string | null = null): Promise<repo.MembershipRow> {
    try {
      return await withTx(this.deps.db, async (tx) => {
        await this.requireOrg(tx, org);
        if (await repo.membershipExists(tx, userId, org)) throw new ResourceAlreadyExistsError('UserOrganization', `${userId}:${org}`);
        const r = role !== null ? requireValidRole(role) : MEMBER_ROLE;
        await repo.insertMembership(tx, { userId, org, role: r, addedBy, createdAt: systemNowMicros() });
        return { userId, orgSlug: org, role: r, addedBy, title: null, showOnPortal: false, createdAt: null as unknown as string };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ResourceAlreadyExistsError('UserOrganization', `${userId}:${org}`);
      throw e;
    }
  }

  async invite(org: string, rawEmails: (string | null)[] | null, role: string | null, invitedBy: string): Promise<InviteResult> {
    const pushes: PushTrigger[] = [];
    const result = await withTx(this.deps.db, async (tx) => {
      const o = await this.requireOrg(tx, org);
      const validRole = role !== null ? requireValidRole(role) : MEMBER_ROLE;
      const emails = this.normalizeEmails(rawEmails);
      const existing = new Map<string, repo.UserRow>();
      for (const u of await repo.findUsersByLowerEmailIn(tx, emails)) {
        const k = lowerRoot(u.email);
        if (!existing.has(k)) existing.set(k, u);
      }
      const added: MemberView[] = [];
      const pending: InviteView[] = [];
      for (const email of emails) {
        const u = existing.get(email);
        if (!u) {
          await repo.upsertInvite(tx, org, email, validRole, invitedBy);
          pending.push({ email, role: validRole, createdAt: formatOffsetDateTime(systemNowMicros(), this.deps.config.server.timeZone) });
        } else if (!(await repo.membershipExists(tx, u.id, org))) {
          await repo.insertMembership(tx, { userId: u.id, org, role: validRole, addedBy: invitedBy, createdAt: systemNowMicros() });
          added.push({ userId: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: validRole, title: null, showOnPortal: false, since: null });
        }
      }
      if (added.length > 0) {
        const name = o.name != null && javaTrim(o.name) !== '' ? o.name : org;
        pushes.push({ kind: 'users', userIds: [...new Set(added.map((a) => a.userId))],
          message: pushMessage(name, `Te sumaron como miembro de ${name}`, { type: 'organization', id: org, org }) });
      }
      return { added, pending };
    });
    firePushes(this.deps, pushes);
    return result;
  }

  revokeInvite(org: string, email: string | null): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (email === null || (await repo.deleteInvite(tx, org, lowerRoot(javaTrim(email)))) === 0) {
        throw new ResourceNotFoundError('OrgInvite', `${org}:${email}`);
      }
    });
  }

  /** claimInvites: a never-seen email's pending invites become memberships (idempotent). */
  claimInvites(userId: string | null, email: string | null, tx?: Db): Promise<number> {
    if (userId === null || email === null) return Promise.resolve(0);
    return withTx(this.db(tx), async (t) => {
      const lower = lowerRoot(email);
      const claimed = await repo.insertMembershipsFromInvites(t, userId, lower);
      await repo.deleteInvitesByEmail(t, lower);
      return claimed;
    });
  }

  /** updateRole (STAFF): no last-admin guard. Returns the updated row. */
  updateRole(userId: string, org: string, role: string | null) {
    return this.update(userId, org, role, null, null, false);
  }

  /** Partial update: null = unchanged; a blank title clears it. */
  update(userId: string, org: string, role: string | null, title: string | null, showOnPortal: boolean | null, guardLastAdmin: boolean): Promise<repo.MembershipRow> {
    return withTx(this.deps.db, async (tx) => {
      const m = await this.find(tx, userId, org);
      const changes: Partial<repo.MembershipRow> = {};
      if (role !== null) {
        const validRole = requireValidRole(role);
        if (guardLastAdmin && m.role === ADMIN_ROLE && validRole !== ADMIN_ROLE) await this.requireAnotherAdmin(tx, org, userId);
        if (validRole !== m.role) changes.role = validRole;
      }
      if (title !== null) {
        const t = javaTrim(title);
        if (t.length > MAX_TITLE_LENGTH) throw new ValidationError('title', title, `must be at most ${MAX_TITLE_LENGTH} characters`);
        const v = t === '' ? null : t;
        if (v !== m.title) changes.title = v;
      }
      if (showOnPortal !== null && showOnPortal !== m.showOnPortal) changes.showOnPortal = showOnPortal;
      await repo.updateMembership(tx, userId, org, changes);
      return { ...m, ...changes };
    });
  }

  memberView(userId: string, org: string): Promise<MemberView> {
    return withTx(this.deps.db, async (tx) => {
      const m = await this.find(tx, userId, org);
      const [u] = await repo.findUsersByIds(tx, [userId]);
      return OrganizationMembershipService.view(m, u ?? null, dbTime(m.createdAt));
    }, { readOnly: true });
  }

  /** Silent no-op when the user is not a member. `guardLastAdmin` is false only for STAFF. */
  remove(userId: string, org: string, guardLastAdmin = false): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const m = await repo.findMembership(tx, userId, org);
      if (!m) return;
      if (guardLastAdmin && m.role === ADMIN_ROLE) await this.requireAnotherAdmin(tx, org, userId);
      await repo.deleteMembership(tx, userId, org);
    });
  }

  transferAdmin(org: string, fromUserId: string, toUserId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (fromUserId === toUserId) throw new ValidationError('userId', toUserId, 'must be another member');
      const target = await this.find(tx, toUserId, org);
      const current = await this.find(tx, fromUserId, org);
      const stillAdmin = (await repo.adminsForUpdate(tx, org)).some((a) => a.userId === fromUserId);
      if (!stillAdmin) throw new InvalidStateError(`You are no longer an admin of ${org}`);
      if (target.role !== ADMIN_ROLE) await repo.updateMembership(tx, toUserId, org, { role: ADMIN_ROLE });
      if (current.role !== MEMBER_ROLE) await repo.updateMembership(tx, fromUserId, org, { role: MEMBER_ROLE });
    });
  }

  /** Account deletion: refuse while the user is the only admin of any org. */
  requireNotLastAdmin(userId: string, tx?: Db): Promise<void> {
    return withTx(this.db(tx), async (t) => {
      for (const m of await repo.membershipsOfUser(t, userId)) {
        if (m.role === ADMIN_ROLE) await this.requireAnotherAdmin(t, m.orgSlug, userId);
      }
    });
  }

  private async requireAnotherAdmin(tx: Db, org: string, leaving: string) {
    const another = (await repo.adminsForUpdate(tx, org)).some((a) => a.userId !== leaving);
    if (!another) throw new LastOrgAdminError(`You are the only admin of '${org}'. Make another member admin first.`);
  }

  private async find(tx: Db, userId: string, org: string) {
    const m = await repo.findMembership(tx, userId, org);
    if (!m) throw new ResourceNotFoundError('UserOrganization', `${userId}:${org}`);
    return m;
  }

  private normalizeEmails(raw: (string | null)[] | null): string[] {
    if (raw === null || raw.length === 0) throw new ValidationError('emails', raw === null ? null : '[]', 'must not be empty');
    if (raw.length > MAX_INVITES_PER_REQUEST) throw new ValidationError('emails', raw.length, `at most ${MAX_INVITES_PER_REQUEST} per request`);
    const out = new Set<string>();
    for (const r of raw) {
      const email = r === null ? '' : lowerRoot(javaTrim(r));
      if (email.length > 320 || !EMAIL.test(email)) throw new ValidationError('emails', r, 'must be an email address');
      if (!admits(this.deps.config.auth, email)) throw new ValidationError('emails', r, 'is not allowed to sign in');
      out.add(email);
    }
    return [...out];
  }
}

export type { Micros };

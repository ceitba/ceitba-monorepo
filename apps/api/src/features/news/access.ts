// web/news/OrgAccess: the @orgAccess bean. Registered as named checks for the
// METHOD_RULES of policy.ts and used inline by the news controllers.

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { findUserByEmail } from '../../http/auth/repo';
import { hasRole, type Principal } from '../../http/auth/principal';
import { stringClaim } from '../../http/auth/jwt';
import { javaIsBlank } from '../../lib/javaCompat';
import type { OrganizationMembershipService } from './memberships';
import * as repo from './repo';

export class OrgAccess {
  constructor(private readonly deps: Deps, private readonly memberships: OrganizationMembershipService) {}

  /**
   * Current user's id: API key -> its User; JWT email -> users row (no JIT
   * provisioning); null for anonymous callers and not-yet-provisioned users.
   */
  async currentUserId(p: Principal): Promise<string | null> {
    if (p.kind === 'anonymous') return null;
    if (p.kind === 'apiKey') return p.key.user.id;
    if (p.kind !== 'jwt') return null;
    const email = stringClaim(p.claims, 'email');
    if (email === null) return null;
    return (await withTx(this.deps.db, (tx) => findUserByEmail(tx, email), { readOnly: true }))?.id ?? null;
  }

  isStaff(p: Principal): boolean {
    return hasRole(p, 'STAFF');
  }

  private async belongsTo(p: Principal, org: string): Promise<boolean> {
    const id = await this.currentUserId(p);
    return id !== null && this.memberships.userBelongsTo(id, org);
  }

  canEditOrg(slug: string | null, p: Principal) {
    return slug !== null && this.belongsTo(p, slug);
  }

  canWriteForOrg(org: string | null, p: Principal) {
    return org !== null && this.belongsTo(p, org);
  }

  canReadDraftsOf(org: string | null, p: Principal) {
    return org !== null && this.belongsTo(p, org);
  }

  async canReadArticleDraft(articleId: string, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    if ((await withTx(this.deps.db, (tx) => repo.independentStatusOwnedBy(tx, articleId, id), { readOnly: true })) !== null) return true;
    const a = await withTx(this.deps.db, (tx) => repo.findArticle(tx, articleId), { readOnly: true });
    return a !== null && a.organization !== null && this.memberships.userBelongsTo(id, a.organization);
  }

  async canViewFollowers(slug: string | null, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    return slug !== null && id !== null && this.memberships.userIsAdminOf(id, slug);
  }

  canManageMembers(slug: string | null, p: Principal) {
    return this.canViewFollowers(slug, p);
  }

  async canDeleteArticle(articleId: string, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    const a = await withTx(this.deps.db, (tx) => repo.findArticle(tx, articleId), { readOnly: true });
    return a !== null && a.organization !== null && this.memberships.userBelongsTo(id, a.organization);
  }

  async canDeleteEvent(eventId: string, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    const e = await withTx(this.deps.db, (tx) => repo.findEvent(tx, eventId), { readOnly: true });
    return e !== null && e.organization !== null && this.memberships.userBelongsTo(id, e.organization);
  }

  async canSeeAttendees(eventId: string, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    const e = await withTx(this.deps.db, (tx) => repo.findEvent(tx, eventId), { readOnly: true });
    return e !== null && e.organization !== null && this.memberships.userSeesAttendeesOf(id, e.organization);
  }

  async canWriteForArticle(articleId: string, patchOrg: string | null, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    const a = await withTx(this.deps.db, (tx) => repo.findArticle(tx, articleId), { readOnly: true });
    return a !== null && this.canMove(id, a.organization, patchOrg);
  }

  isIndependent(org: string | null): boolean {
    return org === null || javaIsBlank(org);
  }

  async canEditOwnIndependentArticle(articleId: string, patchOrg: string | null, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    const status = await withTx(this.deps.db, (tx) => repo.independentStatusOwnedBy(tx, articleId, id), { readOnly: true });
    const editable = status !== null && status !== 'published';
    return editable && (this.isIndependent(patchOrg) || this.memberships.userBelongsTo(id, patchOrg));
  }

  canDeleteOwnIndependentArticle(articleId: string, p: Principal) {
    return this.canEditOwnIndependentArticle(articleId, null, p);
  }

  async canWriteForEvent(eventId: string, patchOrg: string | null, p: Principal): Promise<boolean> {
    const id = await this.currentUserId(p);
    if (id === null) return false;
    const e = await withTx(this.deps.db, (tx) => repo.findEvent(tx, eventId), { readOnly: true });
    return e !== null && this.canMove(id, e.organization, patchOrg);
  }

  private async canMove(userId: string, currentOrg: string | null, patchOrg: string | null): Promise<boolean> {
    if (currentOrg === null || !(await this.memberships.userBelongsTo(userId, currentOrg))) return false;
    return patchOrg === null || patchOrg === currentOrg || this.memberships.userBelongsTo(userId, patchOrg);
  }

  /** deps.accessChecks.register for every `orgAccess.*` name policy.ts uses. */
  register(): void {
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
    const c = this.deps.accessChecks;
    c.register('orgAccess.canEditOrg', ({ principal }, slug) => this.canEditOrg(s(slug), principal));
    c.register('orgAccess.canWriteForOrg', ({ principal }, org) => this.canWriteForOrg(s(org), principal));
    c.register('orgAccess.canReadDraftsOf', ({ principal }, org) => this.canReadDraftsOf(s(org), principal));
    c.register('orgAccess.canReadArticleDraft', ({ principal }, id) => this.canReadArticleDraft(s(id)!, principal));
    c.register('orgAccess.canViewFollowers', ({ principal }, slug) => this.canViewFollowers(s(slug), principal));
    c.register('orgAccess.canManageMembers', ({ principal }, slug) => this.canManageMembers(s(slug), principal));
    c.register('orgAccess.canDeleteArticle', ({ principal }, id) => this.canDeleteArticle(s(id)!, principal));
    c.register('orgAccess.canDeleteEvent', ({ principal }, id) => this.canDeleteEvent(s(id)!, principal));
    c.register('orgAccess.canSeeAttendees', ({ principal }, id) => this.canSeeAttendees(s(id)!, principal));
    c.register('orgAccess.canWriteForArticle', ({ principal }, id, org) => this.canWriteForArticle(s(id)!, s(org), principal));
    c.register('orgAccess.isIndependent', (_ctx, org) => this.isIndependent(s(org)));
    c.register('orgAccess.canEditOwnIndependentArticle', ({ principal }, id, org) => this.canEditOwnIndependentArticle(s(id)!, s(org), principal));
    c.register('orgAccess.canDeleteOwnIndependentArticle', ({ principal }, id) => this.canDeleteOwnIndependentArticle(s(id)!, principal));
    c.register('orgAccess.canWriteForEvent', ({ principal }, id, org) => this.canWriteForEvent(s(id)!, s(org), principal));
  }
}

// service/user/{UserService, UserProfileService, DeviceService, SavedScheduleService}
// plus the slices of FollowService / OrganizationMembershipService /
// EventRsvpService that the /v1/me and /v1/users controllers call.

import type { Deps } from '../../deps';
import { isDataIntegrityViolation, isUniqueViolation, withTx, type Db } from '../../db/client';
import {
  FileNumberAlreadySetError, FileNumberTakenError, ResourceAlreadyExistsError, ResourceNotFoundError, UnexpectedStateError, ValidationError,
} from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, toPgTimestamp } from '../../lib/time';
import type {
  CreateUserRequest, DeviceResponse, MePreferencesResponse, MeProfileResponse, SavedScheduleResponse, UpdatePreferencesRequest,
  UpdateProfileRequest, UserResponse,
} from './dto';
import { writeJackson, type JNode } from '../../lib/jackson';
import { payloadChangedNodes } from './logic/savedSchedulePayload';
import { parseJackson } from '../../lib/jackson';
import * as social from './logic/socialHandles';
import * as repo from './repo';

const fromDb = (pg: string) => formatOffsetDateTime(parsePgTimestamp(pg));
const blankToNull = (s: string | null) => (s == null || javaIsBlank(s) ? null : javaTrim(s));
const nowPg = () => toPgTimestamp(systemNowMicros());

// ------------------------------------------------------------ UserService (/v1/users, STAFF)

export class UserService {
  constructor(private readonly deps: Deps) {}

  async create(req: CreateUserRequest): Promise<UserResponse> {
    const email = req.email!;
    try {
      return await withTx(this.deps.db, async (tx) => {
        if (await repo.findUserByEmail(tx, email)) throw new ResourceAlreadyExistsError('User', email);
        // Validate the FK eagerly so the response is a clean 404, not a 409 from the constraint.
        if (req.careerId !== null && !(await repo.careerExists(tx, req.careerId))) throw new ResourceNotFoundError('Career', req.careerId);
        const ts = nowPg();
        const row: repo.UserRow = {
          id: crypto.randomUUID(), email, fileNumber: req.fileNumber, careerId: req.careerId, plan: req.plan, name: req.name,
          createdAt: ts, updatedAt: ts, preferredLanguage: null, googleSub: null, avatarUrl: null, theme: null,
          linkedin: null, instagram: null, discord: null, firebaseUid: null, digestEmailEnabled: true,
        };
        await repo.insertUser(tx, row);
        // Pending org invites of this email, as on a first login.
        await repo.claimInvites(tx, row.id, row.email);
        return this.toResponse(tx, row);
      });
    } catch (e) {
      // Race or a column constraint not pre-checked (file_number unique...).
      if (isDataIntegrityViolation(e)) throw new ResourceAlreadyExistsError('User', email);
      throw e;
    }
  }

  /** Staff correction of a legajo; null clears it. */
  async updateFileNumber(id: string, fileNumber: number | null): Promise<UserResponse> {
    try {
      return await withTx(this.deps.db, async (tx) => {
        const u = await repo.findUser(tx, id);
        if (!u) throw new ResourceNotFoundError('User', id);
        if (fileNumber !== null) {
          const holder = await repo.findUserByFileNumber(tx, fileNumber);
          if (holder && holder.id !== id) throw new FileNumberTakenError('That file number is already registered to another account.');
        }
        if (u.fileNumber !== fileNumber) {
          u.updatedAt = nowPg();
          u.fileNumber = fileNumber;
          await repo.updateUserColumns(tx, id, { fileNumber, updatedAt: u.updatedAt });
        }
        return this.toResponse(tx, u);
      });
    } catch (e) {
      if (isDataIntegrityViolation(e)) throw new FileNumberTakenError('That file number is already registered to another account.');
      throw e;
    }
  }

  findPaged(q: string | null, organization: string | null, staffOnly: boolean, sort: string, page: number, limit: number) {
    return withTx(this.deps.db, async (tx) => {
      const normalizedQ = q === null ? '' : javaTrim(q).toLowerCase();
      const org = organization === null || javaIsBlank(organization) ? null : organization;
      const pageIdx = Math.max(page - 1, 0);
      const size = Math.min(Math.max(limit, 1), 100);
      const { rows, total } = await repo.findFilteredUsers(tx, {
        q: normalizedQ, organization: org, staffOnly, nowPg: nowPg(), asc: sort.toLowerCase() === 'oldest',
        offset: pageIdx * size, limit: size,
      });
      // Memberships and staff rows of the whole page in two queries (not two per user).
      const ids = rows.map((u) => u.id);
      const memberships = new Map<string, { slug: string; role: string }[]>();
      for (const m of await repo.membershipsOfUsers(tx, ids)) {
        let list = memberships.get(m.userId);
        if (!list) memberships.set(m.userId, (list = []));
        list.push({ slug: m.orgSlug, role: m.role });
      }
      const staff = await repo.activeStaffAmong(tx, ids, nowPg());
      const data = rows.map((u) => userResponse(u, memberships.get(u.id) ?? [], staff.has(u.id)));
      return { data, meta: { total, page: pageIdx + 1, limit: size } };
    }, { readOnly: true });
  }

  getById(id: string): Promise<UserResponse> {
    return withTx(this.deps.db, async (tx) => {
      const u = await repo.findUser(tx, id);
      if (!u) throw new ResourceNotFoundError('User', id);
      return this.toResponse(tx, u);
    }, { readOnly: true });
  }

  private async toResponse(db: Db, u: repo.UserRow): Promise<UserResponse> {
    const memberships = (await repo.membershipsOf(db, u.id)).map((m) => ({ slug: m.orgSlug, role: m.role }));
    return userResponse(u, memberships, await repo.isActiveStaffAt(db, u.id, nowPg()));
  }
}

function userResponse(u: repo.UserRow, organizations: { slug: string; role: string }[], isStaff: boolean): UserResponse {
  return {
    id: u.id, email: u.email, name: u.name, plan: u.plan, avatarUrl: u.avatarUrl, isStaff, organizations,
    file_number: u.fileNumber, career_id: u.careerId,
  };
}

// ------------------------------------------------------------ UserProfileService (/v1/me/{profile,preferences})

export class UserProfileService {
  constructor(private readonly deps: Deps) {}

  getProfile(userId: string): Promise<MeProfileResponse> {
    return withTx(this.deps.db, async (tx) => toProfile(await load(tx, userId)), { readOnly: true });
  }

  /**
   * null = leave alone, "" = clear. A plan must belong to the resulting career;
   * changing the career without a plan clears the plan. fileNumber is set once.
   * Only the changed columns are written (@DynamicUpdate).
   */
  async updateProfile(userId: string, req: UpdateProfileRequest): Promise<MeProfileResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (req.fileNumber !== null) await this.claimFileNumber(tx, userId, Number(javaTrim(req.fileNumber)));
      const u = await load(tx, userId);
      const changes: Partial<repo.UserRow> = {};
      const set = <K extends keyof repo.UserRow>(k: K, v: repo.UserRow[K]) => {
        if (u[k] !== v) { changes[k] = v; u[k] = v; }
      };

      let careerChanged = false;
      if (req.careerId !== null) {
        const id = blankToNull(req.careerId);
        const current = u.careerId;
        if (id !== null && !(await repo.careerExists(tx, id))) throw new ResourceNotFoundError('Career', id);
        set('careerId', id);
        careerChanged = current !== id;
      }
      if (req.plan !== null) {
        const planId = blankToNull(req.plan);
        if (planId === null) {
          set('plan', null);
        } else {
          const career = u.careerId;
          if (career === null) throw new ValidationError('plan', planId, 'a plan requires a career');
          const p = await repo.findPlan(tx, planId);
          if (!p || p.careerId !== career) throw new ValidationError('plan', planId, `is not a plan of career '${career}'`);
          set('plan', planId);
        }
      } else if (careerChanged) {
        set('plan', null);
      }
      const applySocial = (raw: string | null, normalize: (s: string) => string, k: 'linkedin' | 'instagram' | 'discord') => {
        if (raw === null) return;
        const v = blankToNull(raw);
        set(k, v === null ? null : normalize(v));
      };
      applySocial(req.linkedin, social.linkedin, 'linkedin');
      applySocial(req.instagram, social.instagram, 'instagram');
      applySocial(req.discord, social.discord, 'discord');

      if (Object.keys(changes).length > 0) await repo.updateUserColumns(tx, userId, { ...changes, updatedAt: nowPg() });
      return toProfile(u);
    });
  }

  /**
   * The legajo, if the user has none yet. The same number again is a no-op;
   * another one is FileNumberAlreadySet; another user's is FileNumberTaken.
   * The UPDATE ... WHERE file_number IS NULL settles concurrent claims.
   */
  private async claimFileNumber(tx: Db, userId: string, fileNumber: number): Promise<void> {
    const current = (await load(tx, userId)).fileNumber;
    if (current !== null) {
      if (current === fileNumber) return;
      throw new FileNumberAlreadySetError('The file number is already set; ask CEITBA staff to change it.');
    }
    const holder = await repo.findUserByFileNumber(tx, fileNumber);
    if (holder && holder.id !== userId) throw new FileNumberTakenError('That file number is already registered to another account.');
    let updated: number;
    try {
      updated = await repo.setFileNumberIfNull(tx, userId, fileNumber, nowPg());
    } catch (e) {
      if (isDataIntegrityViolation(e)) throw new FileNumberTakenError('That file number is already registered to another account.');
      throw e;
    }
    if (updated === 0) {
      // Another request set it between our read and the UPDATE.
      if ((await load(tx, userId)).fileNumber !== fileNumber) {
        throw new FileNumberAlreadySetError('The file number is already set; ask CEITBA staff to change it.');
      }
    }
  }

  getPreferences(userId: string): Promise<MePreferencesResponse> {
    return withTx(this.deps.db, async (tx) => {
      const u = await load(tx, userId);
      return { theme: u.theme, language: u.preferredLanguage };
    }, { readOnly: true });
  }

  updatePreferences(userId: string, req: UpdatePreferencesRequest): Promise<MePreferencesResponse> {
    return withTx(this.deps.db, async (tx) => {
      const u = await load(tx, userId);
      const changes: Partial<repo.UserRow> = {};
      if (req.theme !== null && blankToNull(req.theme) !== u.theme) changes.theme = u.theme = blankToNull(req.theme);
      if (req.language !== null && blankToNull(req.language) !== u.preferredLanguage) changes.preferredLanguage = u.preferredLanguage = blankToNull(req.language);
      if (Object.keys(changes).length > 0) await repo.updateUserColumns(tx, userId, { ...changes, updatedAt: nowPg() });
      return { theme: u.theme, language: u.preferredLanguage };
    });
  }
}

async function load(db: Db, userId: string): Promise<repo.UserRow> {
  const u = await repo.findUser(db, userId);
  if (!u) throw new ResourceNotFoundError('User', userId);
  return u;
}

function toProfile(u: repo.UserRow): MeProfileResponse {
  return { careerId: u.careerId, plan: u.plan, fileNumber: u.fileNumber, linkedin: u.linkedin, instagram: u.instagram, discord: u.discord };
}

// ------------------------------------------------------------ DeviceService (/v1/me/devices)

/** Bounds the rows one account can create; beyond it the least recently seen devices are dropped. */
export const MAX_DEVICES_PER_USER = 10;

export class DeviceService {
  constructor(private readonly deps: Deps) {}

  /** Idempotent upsert keyed by token; a token of another user is reassigned to `userId`. */
  register(userId: string, token: string, platform: string, appVersion: string | null): Promise<DeviceResponse> {
    return withTx(this.deps.db, async (tx) => {
      const version = appVersion === null || javaIsBlank(appVersion) ? null : javaTrim(appVersion);
      await repo.upsertDevice(tx, { token, userId, platform: platform.toLowerCase(), appVersion: version, nowPg: toPgTimestamp(this.deps.clock.now()) });
      await repo.trimDevices(tx, userId, MAX_DEVICES_PER_USER);
      const d = await repo.findDevice(tx, token);
      // Java: devices.findById(token).orElseThrow() -> NoSuchElementException -> the generic 500.
      if (!d) throw new UnexpectedStateError('NoSuchElementException', `Device ${token} not found after its upsert`);
      return toDevice(d);
    });
  }

  list(userId: string): Promise<DeviceResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.devicesOf(tx, userId)).map(toDevice), { readOnly: true });
  }

  /** Silent no-op for unknown tokens and other users' tokens. */
  unregister(userId: string, token: string): Promise<void> {
    return withTx(this.deps.db, (tx) => repo.deleteDevice(tx, token, userId));
  }
}

function toDevice(d: repo.DeviceRow): DeviceResponse {
  return { token: d.token, platform: d.platform, appVersion: d.appVersion, createdAt: fromDb(d.createdAt), lastSeenAt: fromDb(d.lastSeenAt) };
}

// ------------------------------------------------------------ SavedScheduleService (/v1/me/schedules)

/** Hard cap per user, enforced at write time (409 with a precise code). */
export const MAX_PER_USER = 5;

/** A validated SaveScheduleRequest with the payload as Jackson bound it. */
export interface SaveSchedule {
  name: string;
  careerId: string | null;
  plan: string | null;
  payload: JNode;
}

export class SavedScheduleService {
  constructor(private readonly deps: Deps) {}

  list(userId: string): Promise<SavedScheduleResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.schedulesOf(tx, userId)).map(fromRow), { readOnly: true });
  }

  get(userId: string, id: string): Promise<SavedScheduleResponse> {
    return withTx(this.deps.db, async (tx) => fromRow(await this.find(tx, userId, id)), { readOnly: true });
  }

  /**
   * The user's first schedule becomes primary; later creates never touch the
   * flag. The response is the entity before flush: no timestamps yet (null).
   */
  create(userId: string, req: SaveSchedule): Promise<SavedScheduleResponse> {
    return withTx(this.deps.db, async (tx) => {
      await repo.lockUserSchedules(tx, userId);
      const existing = await repo.countSchedules(tx, userId);
      if (existing >= MAX_PER_USER) {
        throw new ResourceAlreadyExistsError('SavedSchedule', `Saved schedule limit reached (max ${MAX_PER_USER}). Delete one first.`);
      }
      const id = crypto.randomUUID();
      const payloadJson = writeJackson(req.payload);
      const ts = nowPg();
      await repo.insertSchedule(tx, {
        id, userId, name: req.name, careerId: req.careerId, plan: req.plan, payloadJson, isPrimary: existing === 0,
        createdAtPg: ts, payloadUpdatedAtPg: ts,
      });
      return { id, name: req.name, careerId: req.careerId, plan: req.plan, payloadJson, createdAt: null, updatedAt: null, isPrimary: existing === 0 };
    });
  }

  /** Makes `id` the primary (clearing the previous one); idempotent. */
  makePrimary(userId: string, id: string): Promise<SavedScheduleResponse> {
    return withTx(this.deps.db, async (tx) => {
      await repo.lockUserSchedules(tx, userId);
      await this.find(tx, userId, id);
      await repo.clearPrimaryExcept(tx, userId, id);
      const s = await this.find(tx, userId, id);
      const out = fromRow(s);
      if (!s.isPrimary) {
        // saveAndFlush of a dirty entity: @UpdateTimestamp sets an in-memory now (JVM zone).
        const now = systemNowMicros();
        await repo.setPrimary(tx, id, toPgTimestamp(now));
        out.isPrimary = true;
        out.updatedAt = formatOffsetDateTime(now, this.deps.config.server.timeZone);
      }
      return out;
    });
  }

  /**
   * Replaces name/careerId/plan/payload. Only a real payload change moves
   * payload_updated_at. The response is the entity before flush: createdAt and
   * updatedAt as loaded (the update timestamp is written at commit).
   */
  update(userId: string, id: string, req: SaveSchedule): Promise<SavedScheduleResponse> {
    return withTx(this.deps.db, async (tx) => {
      const s = await this.find(tx, userId, id);
      const now = systemNowMicros();
      const changed = payloadChangedNodes(parseJackson(s.payloadText), req.payload);
      const payloadJson = writeJackson(req.payload);
      const dirty = changed || s.name !== req.name || s.careerId !== req.careerId || s.plan !== req.plan;
      if (dirty) {
        await repo.updateSchedule(tx, id, {
          name: req.name, careerId: req.careerId, plan: req.plan, payloadJson, updatedAtPg: toPgTimestamp(now),
          payloadUpdatedAtPg: changed ? toPgTimestamp(now) : undefined,
        });
      }
      return {
        id: s.id, name: req.name, careerId: req.careerId, plan: req.plan, payloadJson,
        createdAt: fromDb(s.createdAt), updatedAt: fromDb(s.updatedAt), isPrimary: s.isPrimary,
      };
    });
  }

  /** Deleting the primary leaves the user with no primary. */
  delete(userId: string, id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      await this.find(tx, userId, id);
      await repo.deleteSchedule(tx, id);
    });
  }

  private async find(db: Db, userId: string, id: string): Promise<repo.SavedScheduleRow> {
    const s = await repo.findSchedule(db, id, userId);
    if (!s) throw new ResourceNotFoundError('SavedSchedule', id);
    return s;
  }
}

function fromRow(s: repo.SavedScheduleRow): SavedScheduleResponse {
  return {
    id: s.id, name: s.name, careerId: s.careerId, plan: s.plan, payloadJson: writeJackson(parseJackson(s.payloadText)),
    createdAt: fromDb(s.createdAt), updatedAt: fromDb(s.updatedAt), isPrimary: s.isPrimary,
  };
}

// ------------------------------------------------------------ follows / memberships / rsvps

export const ADMIN_ROLE = 'admin';
export const MEMBER_ROLE = 'member';
const ROLES = [MEMBER_ROLE, ADMIN_ROLE];

export class MeSocialService {
  constructor(private readonly deps: Deps) {}

  follows(userId: string) {
    return withTx(this.deps.db, async (tx) => (await repo.followsOf(tx, userId))
      .map((f) => ({ orgSlug: f.orgSlug, createdAt: fromDb(f.createdAt) as string | null })), { readOnly: true });
  }

  /**
   * FollowService.follow: 404 unknown org. A new follow answers its in-memory
   * creation time (JVM zone); re-following is a merge of a transient entity,
   * which answers createdAt null.
   */
  async follow(userId: string, slug: string): Promise<{ orgSlug: string; createdAt: string | null }> {
    try {
      return await withTx(this.deps.db, async (tx) => {
        if (!(await repo.orgExists(tx, slug))) throw new ResourceNotFoundError('Organization', slug);
        if (await repo.followExists(tx, userId, slug)) return { orgSlug: slug, createdAt: null };
        const now = systemNowMicros();
        await repo.insertFollow(tx, userId, slug, toPgTimestamp(now));
        return { orgSlug: slug, createdAt: formatOffsetDateTime(now, this.deps.config.server.timeZone) };
      });
    } catch (e) {
      // Already following (race): idempotent, the stored row.
      if (isUniqueViolation(e)) {
        const f = (await withTx(this.deps.db, (tx) => repo.followsOf(tx, userId), { readOnly: true })).find((x) => x.orgSlug === slug);
        if (f) return { orgSlug: f.orgSlug, createdAt: fromDb(f.createdAt) };
      }
      throw e;
    }
  }

  unfollow(userId: string, slug: string): Promise<void> {
    return withTx(this.deps.db, (tx) => repo.deleteFollow(tx, userId, slug));
  }

  memberships(userId: string) {
    return withTx(this.deps.db, async (tx) => (await repo.membershipsOf(tx, userId)).map((m) => ({ slug: m.orgSlug, role: m.role })), { readOnly: true });
  }

  rsvps(userId: string) {
    return withTx(this.deps.db, async (tx) => ({ eventIds: await repo.rsvpEventIdsOf(tx, userId) }), { readOnly: true });
  }

  /** OrganizationMembershipService.add (STAFF): 404 unknown org, 409 already a member. */
  addMembership(userId: string, slug: string, role: string | null) {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.orgExists(tx, slug))) throw new ResourceNotFoundError('Organization', slug);
      if (await repo.findMembership(tx, userId, slug)) throw new ResourceAlreadyExistsError('UserOrganization', `${userId}:${slug}`);
      const r = role !== null ? requireValidRole(role) : MEMBER_ROLE;
      await repo.insertMembership(tx, { userId, orgSlug: slug, role: r, addedBy: null, createdAtPg: nowPg() });
      return { slug, role: r };
    });
  }

  /** updateRole (STAFF: no last-admin guard). */
  updateMembershipRole(userId: string, slug: string, role: string) {
    return withTx(this.deps.db, async (tx) => {
      const m = await repo.findMembership(tx, userId, slug);
      if (!m) throw new ResourceNotFoundError('UserOrganization', `${userId}:${slug}`);
      const r = requireValidRole(role);
      if (m.role !== r) await repo.updateMembershipRole(tx, userId, slug, r);
      return { slug: m.orgSlug, role: r };
    });
  }

  /** remove (STAFF): silent no-op when not a member. */
  removeMembership(userId: string, slug: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (await repo.findMembership(tx, userId, slug)) await repo.deleteMembership(tx, userId, slug);
    });
  }
}

function requireValidRole(role: string): string {
  if (!ROLES.includes(role)) throw new ValidationError('role', role, `must be one of [${ROLES.join(', ')}]`);
  return role;
}

// service/studygroup/StudyGroupService: student study groups (V24).
//
// Timestamps as Hibernate hands them to Jackson (verified on the jar):
//   - rows loaded from the DB print UTC (`...Z`);
//   - on create, createdAt/updatedAt are the in-memory @CreationTimestamp /
//     @UpdateTimestamp (JVM zone), participants written in this request carry
//     OffsetDateTime.now(clock) (clock zone);
//   - on update, updatedAt is in-memory only when a field really changed
//     (Hibernate's dirty check); otherwise the DB value;
//   - dueAt from a request is UTC-adjusted by Jackson and prints `...Z`.

import type { Deps } from '../../deps';
import { withTx, type Tx } from '../../db/client';
import { ResourceNotFoundError, StudyGroupForbiddenError, ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros, type Micros } from '../../lib/time';
import { pageResponse, type PageResponse } from '../news/paging';
import type {
  CreateStudyGroupRequest, StudyGroupLocation, StudyGroupParticipantResponse, StudyGroupResponse, StudyGroupType,
  UpdateStudyGroupRequest,
} from './dto';
import { StudyGroupConflictError } from './errors';
import * as repo from './repo';

export const MAX_PAGE_SIZE = 100;
export const MIN_CAPACITY = 2;

export type LeaveOutcome = 'LEFT' | 'OWNERSHIP_TRANSFERRED' | 'GROUP_DELETED';

/** In-memory values of the entities written in this transaction. */
interface Fresh {
  createdAt?: Micros;
  updatedAt?: Micros;
  dueAt?: Micros;
  /** userId -> joinedAt written now (clock zone). */
  joinedAt?: Map<string, Micros>;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * OffsetDateTime.toString() of a UTC value (what ValidationException shows for
 * a UTC-adjusted request dueAt): seconds omitted when zero together with the
 * fraction, fraction in groups of 3 digits.
 */
export function javaOffsetDateTimeToStringUtc(us: Micros): string {
  const secs = Math.floor(us / 1_000_000);
  const micros = us - secs * 1_000_000;
  const d = new Date(secs * 1000);
  let out = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (d.getUTCSeconds() > 0 || micros > 0) {
    out += `:${pad(d.getUTCSeconds())}`;
    if (micros > 0) out += micros % 1000 === 0 ? `.${pad(micros / 1000, 3)}` : `.${pad(micros, 6)}`;
  }
  return `${out}Z`;
}

const blankToNull = (s: string | null): string | null => (s === null || javaIsBlank(s) ? null : javaTrim(s));
const distinct = <T>(xs: T[]): T[] => [...new Set(xs)];

export class StudyGroupService {
  constructor(private readonly deps: Deps) {}

  private now(): Micros {
    return this.deps.clock.now();
  }

  // --- reads

  list(viewerId: string, moderator: boolean, subjectId: string | null, type: StudyGroupType | null,
    upcomingOnly: boolean, page: number, limit: number): Promise<PageResponse<StudyGroupResponse>> {
    const pageReq = { page: Math.max(page - 1, 0), size: Math.min(Math.max(limit, 1), MAX_PAGE_SIZE) };
    return withTx(this.deps.db, async (tx) => {
      const { rows, total } = await repo.findPage(tx, this.filter(subjectId, type, upcomingOnly, null), pageReq.page * pageReq.size, pageReq.size);
      return pageResponse(await this.summaries(tx, rows, viewerId, moderator), pageReq, total);
    }, { readOnly: true });
  }

  listMine(viewerId: string, moderator: boolean, upcomingOnly: boolean): Promise<StudyGroupResponse[]> {
    return withTx(this.deps.db, async (tx) =>
      this.summaries(tx, await repo.findAll(tx, this.filter(null, null, upcomingOnly, viewerId)), viewerId, moderator), { readOnly: true });
  }

  get(viewerId: string, moderator: boolean, id: string): Promise<StudyGroupResponse> {
    return withTx(this.deps.db, async (tx) => {
      const g = await repo.findById(tx, id);
      if (!g) throw new ResourceNotFoundError('StudyGroup', id);
      return this.detail(tx, g, viewerId, moderator, {});
    }, { readOnly: true });
  }

  // --- writes

  create(ownerId: string, req: CreateStudyGroupRequest): Promise<StudyGroupResponse> {
    return withTx(this.deps.db, async (tx) => {
      const now = this.now();
      await this.requireSubject(tx, req.subjectId!);
      requireFuture(req.dueAt!, now);
      const createdAt = systemNowMicros();
      const updatedAt = systemNowMicros();
      const g = await repo.insertGroup(tx, {
        ownerId, title: javaTrim(req.title!), subjectId: req.subjectId!, type: req.type!, locations: distinct(req.locations! as string[]),
        dueAt: req.dueAt!, description: blankToNull(req.description), contactLink: blankToNull(req.contactLink),
        maxParticipants: capacity(req.maxParticipants),
      }, createdAt, updatedAt);
      await repo.insertMember(tx, g.id, ownerId, now);
      return this.detail(tx, g, ownerId, false, { createdAt, updatedAt, dueAt: req.dueAt!, joinedAt: new Map([[ownerId, now]]) });
    });
  }

  update(userId: string, moderator: boolean, id: string, req: UpdateStudyGroupRequest): Promise<StudyGroupResponse> {
    return withTx(this.deps.db, async (tx) => {
      const g = await this.findForUpdate(tx, id);
      requireCanEdit(g, userId, moderator, 'edit');
      const cur = {
        title: g.title, subjectId: g.subjectId, type: g.type, locations: g.locations, dueAt: parsePgTimestamp(g.dueAt),
        description: g.description, contactLink: g.contactLink, maxParticipants: g.maxParticipants,
      };
      const next = { ...cur };
      if (req.title !== null) {
        if (javaIsBlank(req.title)) throw new ValidationError('title', req.title, 'must not be blank');
        next.title = javaTrim(req.title);
      }
      if (req.subjectId !== null) {
        await this.requireSubject(tx, req.subjectId);
        next.subjectId = req.subjectId;
      }
      if (req.type !== null) next.type = req.type;
      if (req.locations !== null) next.locations = distinct(req.locations as string[]);
      if (req.dueAt !== null) {
        requireFuture(req.dueAt, this.now());
        next.dueAt = req.dueAt;
      }
      if (req.description !== null) next.description = blankToNull(req.description);
      if (req.contactLink !== null) next.contactLink = blankToNull(req.contactLink);
      if (req.maxParticipants !== null) {
        const max = capacity(req.maxParticipants);
        const count = await repo.countMembers(tx, id);
        if (max !== null && max < count) {
          throw new StudyGroupConflictError('CAPACITY_BELOW_MEMBERS', `Group already has ${count} members; capacity can't be set to ${max}`);
        }
        next.maxParticipants = max;
      }
      const dirty = next.title !== cur.title || next.subjectId !== cur.subjectId || next.type !== cur.type
        || next.locations.length !== cur.locations.length || next.locations.some((l, i) => l !== cur.locations[i])
        || next.dueAt !== cur.dueAt || next.description !== cur.description || next.contactLink !== cur.contactLink
        || next.maxParticipants !== cur.maxParticipants;
      const fresh: Fresh = { dueAt: next.dueAt };
      let row = g;
      if (dirty) {
        fresh.updatedAt = systemNowMicros();
        await repo.updateGroup(tx, id, next, fresh.updatedAt);
        row = (await repo.findById(tx, id))!;
      }
      return this.detail(tx, row, userId, moderator, fresh);
    });
  }

  delete(userId: string, moderator: boolean, id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const g = await this.findForUpdate(tx, id);
      requireCanEdit(g, userId, moderator, 'delete');
      await repo.deleteGroup(tx, id); // participants go with it (ON DELETE CASCADE)
    });
  }

  join(userId: string, moderator: boolean, id: string): Promise<StudyGroupResponse> {
    return withTx(this.deps.db, async (tx) => {
      const g = await this.findForUpdate(tx, id);
      const fresh: Fresh = {};
      if (!(await repo.isMember(tx, id, userId))) {
        const now = this.now();
        if (parsePgTimestamp(g.dueAt) <= now) throw new StudyGroupConflictError('PAST_DUE', 'Study group is past its due date');
        if (g.maxParticipants !== null && (await repo.countMembers(tx, id)) >= g.maxParticipants) {
          throw new StudyGroupConflictError('FULL', 'Study group is full');
        }
        await repo.insertMember(tx, id, userId, now);
        fresh.joinedAt = new Map([[userId, now]]);
      }
      return this.detail(tx, g, userId, moderator, fresh);
    });
  }

  /** 404 if not a member; an owner leaving hands over to the earliest joiner, or deletes the group when alone. */
  leave(userId: string, id: string): Promise<LeaveOutcome> {
    return withTx(this.deps.db, async (tx) => {
      const g = await this.findForUpdate(tx, id);
      const members = await repo.members(tx, id);
      if (!members.some((p) => p.userId === userId)) throw new ResourceNotFoundError('StudyGroupMembership', id);
      if (g.ownerId !== userId) {
        await repo.deleteMember(tx, id, userId);
        return 'LEFT';
      }
      const successor = members.find((p) => p.userId !== userId);
      if (!successor) {
        await repo.deleteGroup(tx, id);
        return 'GROUP_DELETED';
      }
      await repo.deleteMember(tx, id, userId);
      await repo.setOwner(tx, id, successor.userId, systemNowMicros());
      return 'OWNERSHIP_TRANSFERRED';
    });
  }

  // --- helpers

  private filter(subjectId: string | null, type: string | null, upcomingOnly: boolean, memberId: string | null): repo.GroupFilter {
    return {
      subjectId: subjectId !== null && !javaIsBlank(subjectId) ? subjectId : null,
      type,
      upcomingAfter: upcomingOnly ? this.now() : null,
      memberId,
    };
  }

  private async findForUpdate(tx: Tx, id: string): Promise<repo.GroupRow> {
    const g = await repo.findByIdForUpdate(tx, id);
    if (!g) throw new ResourceNotFoundError('StudyGroup', id);
    return g;
  }

  private async requireSubject(tx: Tx, subjectId: string): Promise<void> {
    if (!(await repo.subjectExists(tx, subjectId))) throw new ValidationError('subjectId', subjectId, 'unknown subject');
  }

  /** List rendering: batched counts, membership and subject names; no participants. */
  private async summaries(tx: Tx, rows: repo.GroupRow[], viewerId: string, moderator: boolean): Promise<StudyGroupResponse[]> {
    if (!rows.length) return [];
    const ids = rows.map((g) => g.id);
    const counts = await repo.memberCounts(tx, ids);
    const joined = await repo.joinedGroupIds(tx, viewerId, ids);
    const names = await repo.subjectNames(tx, distinct(rows.map((g) => g.subjectId)));
    return rows.map((g) => this.toResponse(g, viewerId, moderator, counts.get(g.id) ?? 0, joined.has(g.id), names, undefined, {}));
  }

  private async detail(tx: Tx, g: repo.GroupRow, viewerId: string, moderator: boolean, fresh: Fresh): Promise<StudyGroupResponse> {
    const members = await repo.members(tx, g.id);
    const users = await repo.usersByIds(tx, members.map((p) => p.userId));
    const views: StudyGroupParticipantResponse[] = members.map((p) => {
      const u = users.get(p.userId);
      const freshJoin = fresh.joinedAt?.get(p.userId);
      return {
        name: u ? u.name : null,
        avatarUrl: u ? u.avatarUrl : null,
        joinedAt: freshJoin !== undefined ? formatOffsetDateTime(freshJoin, this.deps.clock.zone) : formatOffsetDateTime(parsePgTimestamp(p.joinedAt)),
        isOwner: g.ownerId === p.userId,
      };
    });
    const member = members.some((p) => p.userId === viewerId);
    return this.toResponse(g, viewerId, moderator, members.length, member, await repo.subjectNames(tx, [g.subjectId]), views, fresh);
  }

  private toResponse(g: repo.GroupRow, viewerId: string, moderator: boolean, count: number, member: boolean,
    subjectNames: Map<string, string>, participants: StudyGroupParticipantResponse[] | undefined, fresh: Fresh): StudyGroupResponse {
    const owner = g.ownerId === viewerId;
    const max = g.maxParticipants;
    const jvm = this.deps.config.server.timeZone;
    const out: StudyGroupResponse = {
      id: g.id,
      title: g.title,
      subject: { id: g.subjectId, name: subjectNames.get(g.subjectId) ?? null },
      type: g.type as StudyGroupType,
      locations: g.locations as StudyGroupLocation[],
      dueAt: formatOffsetDateTime(fresh.dueAt ?? parsePgTimestamp(g.dueAt)),
      description: g.description,
      contactLink: member ? g.contactLink : null,
      maxParticipants: max,
      participantCount: count,
      canEdit: owner || moderator,
      createdAt: '',
      updatedAt: '',
      isFull: max !== null && count >= max,
      isMember: member,
      isOwner: owner,
    };
    // participants (@JsonInclude NON_NULL) sits between canEdit and createdAt.
    const ordered: StudyGroupResponse = {
      ...pick(out, ['id', 'title', 'subject', 'type', 'locations', 'dueAt', 'description', 'contactLink', 'maxParticipants', 'participantCount', 'canEdit']),
      ...(participants !== undefined ? { participants } : {}),
      createdAt: fresh.createdAt !== undefined ? formatOffsetDateTime(fresh.createdAt, jvm) : formatOffsetDateTime(parsePgTimestamp(g.createdAt)),
      updatedAt: fresh.updatedAt !== undefined ? formatOffsetDateTime(fresh.updatedAt, jvm) : formatOffsetDateTime(parsePgTimestamp(g.updatedAt)),
      isFull: out.isFull,
      isMember: out.isMember,
      isOwner: out.isOwner,
    } as StudyGroupResponse;
    return ordered;
  }
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  const r = {} as Pick<T, K>;
  for (const k of keys) r[k] = o[k];
  return r;
}

function requireCanEdit(g: repo.GroupRow, userId: string, moderator: boolean, action: string): void {
  if (!moderator && g.ownerId !== userId) throw new StudyGroupForbiddenError(`Only the group owner or a moderator can ${action} this study group`);
}

function requireFuture(dueAt: Micros, now: Micros): void {
  if (!(dueAt > now)) throw new ValidationError('dueAt', javaOffsetDateTimeToStringUtc(dueAt), 'must be in the future');
}

/** 0 / null = unlimited (NULL); otherwise at least the owner plus one. */
function capacity(requested: number | null): number | null {
  if (requested === null || requested === 0) return null;
  if (requested < MIN_CAPACITY) throw new ValidationError('maxParticipants', requested, `must be 0 (unlimited) or at least ${MIN_CAPACITY}`);
  return requested;
}

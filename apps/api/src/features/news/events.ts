// service/news/NewsEventService + EventRsvpService (+ EventRsvpException) + EventReminderService.

import type { Db } from '../../db/client';
import { withTx } from '../../db/client';
import type { Deps } from '../../deps';
import { CodedError, InvalidStateError, ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { pushMessage } from '../push/service';
import { isBefore, javaIsBlank, javaTrim, plusDays } from '../../lib/javaCompat';
import { formatOffsetDateTime, formatPgTime, systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { Attendee, NewsEventResponse } from './dto';
import { dbTime, type OrganizationMembershipService } from './memberships';
import { pageResponse, type PageRequest, type PageResponse } from './paging';
import { firePushes, type PushTrigger } from './pushTriggers';
import { orgPush, TYPE_EVENT } from './pushes';
import * as repo from './repo';

export const SIGNUP_NONE = 'none';
export const SIGNUP_EXTERNAL = 'external';
export const SIGNUP_RSVP = 'rsvp';

/** EventRsvpException.Reason -> 409 with the reason's code. */
export const RSVP_REASONS = {
  NOT_RSVP: { code: 'EventNotRsvp', message: 'This event does not take RSVPs' },
  ENDED: { code: 'EventEnded', message: 'This event already took place' },
  FULL: { code: 'EventFull', message: 'This event is full' },
} as const;

export class EventRsvpError extends CodedError {
  constructor(readonly reason: keyof typeof RSVP_REASONS) {
    super(409, RSVP_REASONS[reason].code, RSVP_REASONS[reason].message);
  }
}

/**
 * A LocalTime that Jackson prints from memory (not read through java.sql.Time):
 * ISO_LOCAL_TIME, seconds always, fraction without trailing zeros.
 */
export function formatInputTime(t: string): string {
  const m = /^(\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(t);
  if (!m) return t;
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return frac ? `${m[1]}.${frac}` : m[1]!;
}

export interface EventEntity {
  row: repo.EventRow;
  createdAtText: string | null;
  /** Times as given in the request (the entity was not re-read). */
  fromInput: boolean;
}

export function eventResponse(e: EventEntity, rsvpCount: number): NewsEventResponse {
  const r = e.row;
  const time = (t: string) => (e.fromInput ? formatInputTime(t) : formatPgTime(t)!);
  return {
    id: r.id, title: r.title, eventDate: r.eventDate, startTime: time(r.startTime), endTime: time(r.endTime),
    location: r.location, category: r.category, organization: r.organization, description: r.description,
    createdAt: e.createdAtText, coverImage: r.coverImage, onlineUrl: r.onlineUrl, signupMode: r.signupMode,
    signupUrl: r.signupUrl, capacity: r.capacity, rsvpCount,
  };
}

/** NewsEventService.Extras */
export interface EventExtras {
  coverImage: string | null;
  onlineUrl: string | null;
  signupMode: string | null;
  signupUrl: string | null;
  capacity: number | null;
}

const blankToNull = (s: string) => (javaIsBlank(s) ? null : javaTrim(s));

/** NewsEventService.applyExtras */
export function applyExtras(e: repo.EventRow, x: EventExtras | null): void {
  if (!x) return;
  if (x.coverImage !== null) e.coverImage = blankToNull(x.coverImage);
  if (x.onlineUrl !== null) e.onlineUrl = blankToNull(x.onlineUrl);
  if (x.signupMode === null) return;
  const url = x.signupUrl === null ? null : blankToNull(x.signupUrl);
  switch (x.signupMode) {
    case SIGNUP_EXTERNAL:
      if (url === null) throw new ValidationError('signupUrl', null, 'is required for external sign-up');
      e.signupUrl = url;
      e.capacity = null;
      break;
    case SIGNUP_RSVP:
      e.signupUrl = null;
      e.capacity = x.capacity;
      break;
    case SIGNUP_NONE:
      e.signupUrl = null;
      e.capacity = null;
      break;
    default:
      throw new ValidationError('signupMode', x.signupMode, 'must be none, external or rsvp');
  }
  e.signupMode = x.signupMode;
}

export interface NewEvent {
  id: string | null;
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  category: string;
  description: string | null;
}

export interface EventPatch {
  title: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  category: string | null;
  description: string | null;
}

export class NewsEventService {
  constructor(private readonly deps: Deps, private readonly memberships: OrganizationMembershipService) {}

  findAll(category: string | null, organization: string | null, from: string | null, to: string | null, page: PageRequest): Promise<PageResponse<NewsEventResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const { rows, total } = await repo.findEvents(tx, { category, organization, from: from ?? '1900-01-01', to: to ?? '2999-12-31' }, page);
      const counts = await repo.rsvpCounts(tx, rows.map((r) => r.id));
      return pageResponse(rows.map((r) => eventResponse({ row: r, createdAtText: dbTime(r.createdAt), fromInput: false }, counts.get(r.id) ?? 0)), page, total);
    }, { readOnly: true });
  }

  get(id: string): Promise<NewsEventResponse> {
    return withTx(this.deps.db, async (tx) => {
      const r = await this.findById(tx, id);
      return eventResponse({ row: r, createdAtText: dbTime(r.createdAt), fromInput: false }, await repo.countRsvps(tx, id));
    }, { readOnly: true });
  }

  private async findById(tx: Db, id: string) {
    const r = await repo.findEvent(tx, id);
    if (!r) throw new ResourceNotFoundError('Event', id);
    return r;
  }

  private async resolveOrganization(tx: Db, slug: string | null): Promise<repo.OrgRow | null> {
    if (slug === null || javaIsBlank(slug)) return null;
    const o = await repo.findOrg(tx, slug);
    if (!o) throw new ResourceNotFoundError('Organization', slug);
    return o;
  }

  /** create: response from the saved entity (rsvpCount 0, times as given, createdAt from memory). */
  async create(input: NewEvent, organizationSlug: string | null, createdBy: string, extras: EventExtras | null): Promise<NewsEventResponse> {
    const createdAt = systemNowMicros();
    const pushes: PushTrigger[] = [];
    const saved = await withTx(this.deps.db, async (tx) => {
      let id = input.id;
      if (id === null || javaIsBlank(id)) id = crypto.randomUUID();
      else if (await repo.eventExists(tx, id)) throw new ResourceAlreadyExistsError('Event', id);
      const row: repo.EventRow = {
        id, title: input.title, eventDate: input.eventDate, startTime: input.startTime, endTime: input.endTime, location: input.location,
        category: input.category, organization: null, description: input.description, createdAt: toPgTimestamp(createdAt), createdBy,
        coverImage: null, onlineUrl: null, signupMode: SIGNUP_NONE, signupUrl: null, capacity: null, reminderSentAt: null,
      };
      const org = await this.resolveOrganization(tx, organizationSlug);
      if (org) row.organization = org.slug;
      applyExtras(row, extras);
      await repo.insertEvent(tx, row);
      const t = orgPush(org, row.title, TYPE_EVENT, row.id);
      if (t) pushes.push(t);
      return row;
    });
    firePushes(this.deps, pushes);
    return eventResponse({ row: saved, createdAtText: formatOffsetDateTime(createdAt, this.deps.config.server.timeZone), fromInput: true }, 0);
  }

  /** update: the response re-counts RSVPs; the entity keeps request times where they were patched. */
  async update(id: string, patch: EventPatch, organizationSlug: string | null, extras: EventExtras | null): Promise<NewsEventResponse> {
    return withTx(this.deps.db, async (tx) => {
      const e = await this.findById(tx, id);
      applyExtras(e, extras);
      if (patch.title !== null) e.title = patch.title;
      if (patch.eventDate !== null && patch.eventDate !== e.eventDate) {
        e.eventDate = patch.eventDate;
        e.reminderSentAt = null;
      }
      const times: { start?: string; end?: string } = {};
      if (patch.startTime !== null) { e.startTime = patch.startTime; times.start = formatInputTime(patch.startTime); }
      if (patch.endTime !== null) { e.endTime = patch.endTime; times.end = formatInputTime(patch.endTime); }
      if (patch.location !== null) e.location = patch.location;
      if (patch.category !== null) e.category = patch.category;
      if (patch.description !== null) e.description = patch.description;
      if (organizationSlug !== null) {
        const org = await this.resolveOrganization(tx, organizationSlug);
        if (org) e.organization = org.slug;
      }
      await repo.updateEvent(tx, e);
      const res = eventResponse({ row: e, createdAtText: dbTime(e.createdAt), fromInput: false }, await repo.countRsvps(tx, id));
      if (times.start) res.startTime = times.start;
      if (times.end) res.endTime = times.end;
      return res;
    });
  }

  delete(id: string, orgMember: string | null): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const e = await repo.findEvent(tx, id, true);
      if (!e) throw new ResourceNotFoundError('Event', id);
      if (orgMember !== null && (e.organization === null || !(await this.memberships.userBelongsTo(orgMember, e.organization, tx)))) {
        throw new InvalidStateError(`Event ${id} no longer belongs to one of your organizations`);
      }
      await repo.deleteEvent(tx, id);
    });
  }
}

export class EventRsvpService {
  constructor(private readonly deps: Deps) {}

  /** Going is idempotent; the capacity check runs under the event's row lock. */
  rsvp(eventId: string, userId: string): Promise<number> {
    return withTx(this.deps.db, async (tx) => {
      const e = await repo.findEvent(tx, eventId, true);
      if (!e) throw new ResourceNotFoundError('Event', eventId);
      if (e.signupMode !== SIGNUP_RSVP) throw new EventRsvpError('NOT_RSVP');
      if (isBefore(e.eventDate, this.deps.clock.today())) throw new EventRsvpError('ENDED');
      if (await repo.rsvpExists(tx, eventId, userId)) return repo.countRsvps(tx, eventId);
      const going = await repo.countRsvps(tx, eventId);
      if (e.capacity !== null && going >= e.capacity) throw new EventRsvpError('FULL');
      await repo.insertRsvp(tx, eventId, userId, systemNowMicros());
      return going + 1;
    });
  }

  cancel(eventId: string, userId: string): Promise<number> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.eventExists(tx, eventId))) throw new ResourceNotFoundError('Event', eventId);
      await repo.deleteRsvp(tx, eventId, userId);
      return repo.countRsvps(tx, eventId);
    });
  }

  isGoing(eventId: string, userId: string): Promise<boolean> {
    return repo.rsvpExists(this.deps.db, eventId, userId);
  }

  /** eventIdsOf (GET /v1/me/rsvps). */
  eventIdsOf(userId: string): Promise<string[]> {
    return repo.rsvpEventIdsOf(this.deps.db, userId);
  }

  attendees(eventId: string): Promise<Attendee[]> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.eventExists(tx, eventId))) throw new ResourceNotFoundError('Event', eventId);
      const list = await repo.rsvpsOfEvent(tx, eventId);
      const byId = new Map((await repo.findUsersByIds(tx, list.map((r) => r.userId))).map((u) => [u.id, u]));
      return list.map((r) => {
        const u = byId.get(r.userId);
        return { userId: r.userId, name: u?.name ?? null, email: u?.email ?? null, createdAt: dbTime(r.createdAt)! };
      });
    }, { readOnly: true });
  }
}

/** EventReminderService: day-before push to the people going to an RSVP event. */
export class EventReminderService {
  constructor(private readonly deps: Deps) {}

  /** Number of events whose reminder this call sent. */
  async sendDueReminders(): Promise<number> {
    const pushes: PushTrigger[] = [];
    const sent = await withTx(this.deps.db, async (tx) => {
      const tomorrow = plusDays(this.deps.clock.today(), 1);
      const now = this.deps.clock.now();
      let n = 0;
      for (const id of await repo.reminderDue(tx, tomorrow)) {
        const users = [...new Set(await repo.rsvpUserIds(tx, id))];
        if (users.length === 0) continue;
        if ((await repo.claimReminder(tx, id, now)) !== 1) continue;
        const e = (await repo.findEvent(tx, id))!;
        const body = `Mañana a las ${e.startTime.slice(0, 5)} · ${e.location}`;
        const data: Record<string, string> = { type: 'event', id };
        if (e.organization !== null) data.org = e.organization;
        pushes.push({ kind: 'users', userIds: users, message: pushMessage(e.title, body, data) });
        n++;
      }
      return n;
    });
    firePushes(this.deps, pushes);
    return sent;
  }
}

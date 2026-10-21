// Ports apps/api/src/test/java/org/ceitba/api/service/studygroup/StudyGroupServiceTest.java.
// The Java test mocks the repositories (Mockito); here the service runs on a
// real database clone with a fixed clock (2026-05-10T15:00Z, zone UTC), and
// each `verify(...)` becomes an assertion on the resulting rows:
//   verify(participants).save/saveAndFlush(captor)  -> the participant row and its joined_at
//   verify(groups, never()).save/delete(...)        -> no study_groups row created / the row still exists
//   verify(participants, never()).countByGroupId    -> (unlimited join) the join succeeds; the query count is not observable
//   verify(..., never()).findByGroupIdOrderBy...    -> (list) items carry no participants
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { seedUser } from '../../contract/support/identity';
import { ResourceNotFoundError, StudyGroupForbiddenError, ValidationError } from '../../src/http/errors';
import { MutableClock } from '../../src/infra/clock';
import { StudyGroupConflictError } from '../../src/features/studygroup/errors';
import { StudyGroupService } from '../../src/features/studygroup/service';
import type { UpdateStudyGroupRequest } from '../../src/features/studygroup/dto';
import { testApp, type TestApp } from '../support/app';

const NOW = Date.parse('2026-05-10T15:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const SUBJECT = '93.41';
const us = (ms: number) => ms * 1000;

let t: TestApp;
let service: StudyGroupService;
let owner: string;
let alice: string;
let bob: string;

beforeAll(async () => {
  t = await testApp({ overrides: { clock: new MutableClock(us(NOW), 'UTC') } });
  service = new StudyGroupService(t.deps);
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await t.sql`TRUNCATE public."user", public.subject CASCADE`;
  await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES (${SUBJECT}, 'Algebra', 9, now())`;
  owner = await seedUser(t.sql, 'owner@itba.edu.ar', { name: null });
  alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: null });
  bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: null });
});

async function group(max: number | null, dueAtMs: number): Promise<string> {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO public.study_groups (id, owner_id, title, subject_id, type, locations, due_at, contact_link, max_participants)
              VALUES (${id}, ${owner}, 'Parcial', ${SUBJECT}, 'EXAMEN', ARRAY['SDF'], ${new Date(dueAtMs).toISOString()}, 'https://chat.example.org/abc', ${max})`;
  return id;
}

async function members(groupId: string, ...userIds: string[]): Promise<void> {
  for (let i = 0; i < userIds.length; i++) {
    await t.sql`INSERT INTO public.study_group_participants (group_id, user_id, joined_at)
                VALUES (${groupId}, ${userIds[i]!}, ${new Date(NOW - 10 * D + i * H).toISOString()})`;
  }
}

const memberRows = (groupId: string) =>
  t.sql`SELECT user_id::text AS u, joined_at FROM public.study_group_participants WHERE group_id = ${groupId} ORDER BY joined_at, user_id`;
const ownerOf = async (groupId: string) => ((await t.sql`SELECT owner_id::text AS o FROM public.study_groups WHERE id = ${groupId}`)[0]?.o as string | undefined);
const groupCount = async () => Number((await t.sql`SELECT count(*)::int AS n FROM public.study_groups`)[0]!.n);

const createReq = (dueAtMs: number, max: number | null) => ({
  title: '  Parcial  ', subjectId: SUBJECT, type: 'EXAMEN' as const, locations: ['SDF', 'SDF', 'VIRTUAL'] as ('SDF' | 'VIRTUAL')[],
  dueAt: us(dueAtMs), description: ' ', contactLink: 'https://chat.example.org/abc', maxParticipants: max,
});
const patch = (o: Partial<UpdateStudyGroupRequest>): UpdateStudyGroupRequest => ({
  title: null, subjectId: null, type: null, locations: null, dueAt: null, description: null, contactLink: null, maxParticipants: null, ...o,
});

async function rejects(p: Promise<unknown>, cls: new (...a: never[]) => Error): Promise<Error> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(cls);
    return e as Error;
  }
  throw new Error(`expected ${cls.name}`);
}

describe('StudyGroupServiceTest', () => {
  test('createMakesTheCreatorOwnerAndFirstParticipant', async () => {
    const res = await service.create(owner, createReq(NOW + D, 0));
    const rows = await memberRows(res.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.u).toBe(owner);
    expect(Date.parse(rows[0]!.joined_at)).toBe(NOW);
    expect(res.participants![0]!.joinedAt).toBe('2026-05-10T15:00:00Z'); // the clock's zone (UTC here)
    expect(res.title).toBe('Parcial');
    expect(res.maxParticipants).toBeNull();
    expect(res.description).toBeNull();
    expect(res.locations).toEqual(['SDF', 'VIRTUAL']);
    expect(res.isOwner).toBe(true);
    expect(res.canEdit).toBe(true);
    expect(res.subject.name).toBe('Algebra');
  });

  test('createRejectsUnknownSubject', async () => {
    const e = await rejects(service.create(owner, { ...createReq(NOW + D, null), title: 't', subjectId: 'XX.99', type: 'GUIAS' as never, locations: ['SDR' as never], description: null, contactLink: null }), ValidationError);
    expect(e.message).toContain('subjectId');
    expect(await groupCount()).toBe(0);
  });

  test('createRejectsDueDateNotInTheFuture', async () => {
    const e = await rejects(service.create(owner, createReq(NOW, null)), ValidationError);
    expect(e.message).toContain('dueAt');
  });

  test('createRejectsCapacityOfOne', async () => {
    const e = await rejects(service.create(owner, createReq(NOW + D, 1)), ValidationError);
    expect(e.message).toContain('maxParticipants');
  });

  test('joinAddsTheCallerWithClockTime', async () => {
    const g = await group(3, NOW + D);
    await members(g, owner);
    await service.join(alice, false, g);
    const rows = await memberRows(g);
    const mine = rows.find((r) => r.u === alice);
    expect(mine).toBeDefined();
    expect(Date.parse(mine!.joined_at)).toBe(NOW);
  });

  test('joinFullGroupIsConflict', async () => {
    const g = await group(2, NOW + D);
    await members(g, owner, bob);
    const e = await rejects(service.join(alice, false, g), StudyGroupConflictError);
    expect((e as StudyGroupConflictError).reason).toBe('FULL');
    expect(await memberRows(g)).toHaveLength(2);
  });

  test('joinPastDueGroupIsConflict', async () => {
    const g = await group(null, NOW); // due exactly now counts as past due
    await members(g, owner);
    const e = await rejects(service.join(alice, false, g), StudyGroupConflictError);
    expect((e as StudyGroupConflictError).reason).toBe('PAST_DUE');
  });

  test('joinUnlimitedGroupNeverChecksCapacity', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner, bob);
    await service.join(alice, false, g);
    expect(await memberRows(g)).toHaveLength(3);
  });

  test('joinWhenAlreadyMemberIsNoOp', async () => {
    const g = await group(2, NOW - D); // even if full and past due
    await members(g, owner, alice);
    const res = await service.join(alice, false, g);
    expect(await memberRows(g)).toHaveLength(2);
    expect(res.isMember).toBe(true);
  });

  test('joinUnknownGroupIsNotFound', async () => {
    await rejects(service.join(alice, false, crypto.randomUUID()), ResourceNotFoundError);
  });

  test('memberLeaves', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner, alice);
    expect(await service.leave(alice, g)).toBe('LEFT');
    expect((await memberRows(g)).map((r) => r.u)).toEqual([owner]);
    expect(await ownerOf(g)).toBe(owner);
  });

  test('leavingWhenNotAMemberIsNotFound', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner);
    await rejects(service.leave(alice, g), ResourceNotFoundError);
  });

  test('ownerLeavingAloneDeletesTheGroup', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner);
    expect(await service.leave(owner, g)).toBe('GROUP_DELETED');
    expect(await groupCount()).toBe(0);
  });

  test('ownerLeavingTransfersToEarliestJoiner', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner, bob, alice); // bob joined before alice
    expect(await service.leave(owner, g)).toBe('OWNERSHIP_TRANSFERRED');
    expect(await ownerOf(g)).toBe(bob);
    expect((await memberRows(g)).map((r) => r.u)).toEqual([bob, alice]);
    expect(await groupCount()).toBe(1);
  });

  test('strangerCannotEditOrDelete', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner);
    await rejects(service.update(alice, false, g, patch({ maxParticipants: 5 })), StudyGroupForbiddenError);
    await rejects(service.delete(alice, false, g), StudyGroupForbiddenError);
    expect(await groupCount()).toBe(1);
  });

  test('moderatorCanEditAndDelete', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner);
    const res = await service.update(alice, true, g, patch({ title: 'Nuevo', type: 'GUIAS', description: '', contactLink: '  ' }));
    expect(res.title).toBe('Nuevo');
    expect(res.type).toBe('GUIAS');
    expect(res.canEdit).toBe(true);
    expect(res.isOwner).toBe(false);
    expect((await t.sql`SELECT contact_link FROM public.study_groups WHERE id = ${g}`)[0]!.contact_link).toBeNull(); // blank clears
    await service.delete(alice, true, g);
    expect(await groupCount()).toBe(0);
  });

  test('capacityCannotDropBelowMembers', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner, alice, bob);
    const e = await rejects(service.update(owner, false, g, patch({ maxParticipants: 2 })), StudyGroupConflictError);
    expect((e as StudyGroupConflictError).reason).toBe('CAPACITY_BELOW_MEMBERS');
    expect((await service.update(owner, false, g, patch({ maxParticipants: 3 }))).maxParticipants).toBe(3);
    expect((await service.update(owner, false, g, patch({ maxParticipants: 0 }))).maxParticipants).toBeNull();
  });

  test('updateRejectsBlankTitleAndPastDueDate', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner);
    await rejects(service.update(owner, false, g, patch({ title: '   ' })), ValidationError);
    await rejects(service.update(owner, false, g, patch({ dueAt: us(NOW - 60_000) })), ValidationError);
  });

  test('contactLinkIsMembersOnly', async () => {
    const g = await group(2, NOW + D);
    await members(g, owner, bob);
    const stranger = await service.get(alice, false, g);
    expect(stranger.contactLink).toBeNull();
    expect(stranger.isMember).toBe(false);
    expect(stranger.isFull).toBe(true);
    expect(stranger.canEdit).toBe(false);
    expect((await service.get(bob, false, g)).contactLink).toBe('https://chat.example.org/abc');
    const mod = await service.get(alice, true, g);
    expect(mod.canEdit).toBe(true);
    expect(mod.contactLink).toBeNull();
  });

  test('participantsExposeNameAndAvatarOnly', async () => {
    const g = await group(null, NOW + D);
    await members(g, owner, bob);
    await t.sql`UPDATE public."user" SET name = 'Olivia', avatar_url = 'https://img.example.org/o.png' WHERE id = ${owner}`;
    await t.sql`UPDATE public."user" SET name = 'Bob' WHERE id = ${bob}`;
    const res = await service.get(bob, false, g);
    expect(res.participants).toHaveLength(2);
    expect(res.participants![0]!.name).toBe('Olivia');
    expect(res.participants![0]!.avatarUrl).toBe('https://img.example.org/o.png');
    expect(res.participants![0]!.isOwner).toBe(true);
    expect(res.participants![1]!.isOwner).toBe(false);
    expect(JSON.stringify(res.participants)).not.toContain('@itba.edu.ar');
  });

  test('listPageUsesBatchedCountsAndMembership', async () => {
    const a = await group(2, NOW + D);
    const b = await group(null, NOW + 2 * D);
    await members(a, owner, bob);
    await members(b, alice);
    const page = (await service.list(alice, false, null, null, true, 1, 500)).data;
    expect(page.map((g) => g.id)).toEqual([a, b]);
    expect(page[0]!.isFull).toBe(true);
    expect(page[0]!.isMember).toBe(false);
    expect(page[0]!.contactLink).toBeNull();
    expect(page[0]!.participants).toBeUndefined();
    expect(page[1]!.participantCount).toBe(1);
    expect(page[1]!.isMember).toBe(true);
    expect(page[1]!.contactLink).not.toBeNull();
    expect((await service.list(alice, false, null, null, true, 1, 500)).meta.limit).toBe(100);
  });
});

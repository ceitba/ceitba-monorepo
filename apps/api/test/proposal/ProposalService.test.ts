// Port of apps/api/src/test/java/org/ceitba/api/service/proposal/ProposalServiceTest.java.
// The Java test mocks the repositories over in-memory maps; here the services
// run against a real database clone (testApp), with rows seeded by SQL where
// the Java test stubbed `findById`/`findByIdAndProposalId`. The media service
// is real over a stub store (as in Java); the clock is fixed like CLOCK.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { seedUser } from '../../contract/support';
import { ContentHmac } from '../../src/features/crypto/logic/contentHmac';
import { MediaUploadService } from '../../src/features/media/logic/mediaUploadService';
import { onProposalStatusChanged, type ProposalStatusChangedEvent } from '../../src/features/proposal/events';
import { ProposalAliasGenerator } from '../../src/features/proposal/logic/proposalAliasGenerator';
import {
  COMMENT_RATE_RULE, CREATE_RATE_RULE, MAX_PAGE_SIZE, pageable, ProposalModerationService, ProposalService,
} from '../../src/features/proposal/service';
import { InvalidStateError, RateLimitExceededError, ResourceNotFoundError, ValidationError } from '../../src/http/errors';
import { UserRateLimiter } from '../../src/http/ratelimit';
import { MutableClock } from '../../src/infra/clock';
import type { ObjectStorage, PresignedUpload } from '../../src/infra/storage';
import { testApp, type TestApp } from '../support/app';
import { TEST_JWT_SECRET } from '../../contract/support/env';

const AUTHOR = 'a0000000-0000-4000-8000-000000000001';
const ALICE = 'a0000000-0000-4000-8000-000000000002';
const BOB = 'a0000000-0000-4000-8000-000000000003';
const MOD = 'a0000000-0000-4000-8000-000000000004';
const CLOCK = new MutableClock('2026-03-01T12:00:00Z');

/** Real service over a stub store, like the Java test. */
class StubStorage implements ObjectStorage {
  readonly configured = true;
  async presignPut(key: string): Promise<PresignedUpload> { return { uploadUrl: `https://bucket.test/${key}`, headers: {}, expiresAtMicros: 0 }; }
  publicUrl(key: string) { return `https://media.test/${key}`; }
  async put() {}
  async get() { return null; }
  async delete() {}
  async presignGet() { return ''; }
}
const media = new MediaUploadService(new StubStorage(), () => {}, ContentHmac.fromJwtSecret(TEST_JWT_SECRET));

let t: TestApp;
let service: ProposalService;
let moderation: ProposalModerationService;
let events: ProposalStatusChangedEvent[] = [];
let unsubscribe = () => {};

/** new ProposalAliasGenerator(List.of("AlfaRojo", "BetaAzul", "GammaVerde"), new Random(7)) */
const generator = () => new ProposalAliasGenerator(['AlfaRojo', 'BetaAzul', 'GammaVerde'], { nextInt: (b) => 7 % b });

beforeAll(async () => {
  t = await testApp({ overrides: { clock: CLOCK } });
  service = new ProposalService(t.deps, { aliasGenerator: generator(), media, consume: () => {} });
  moderation = new ProposalModerationService(t.deps, { aliasGenerator: generator(), media });
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await t.sql`TRUNCATE public."user" CASCADE`;
  for (const [id, email] of [[AUTHOR, 'author'], [ALICE, 'alice'], [BOB, 'bob'], [MOD, 'mod']] as const) {
    await seedUser(t.sql, `${email}@itba.edu.ar`, { id });
  }
  events = [];
  unsubscribe = onProposalStatusChanged((e) => events.push(e));
});
afterEach(() => unsubscribe());

/** stored(status): a proposal row by AUTHOR, moderated by MOD unless PENDING. */
async function stored(status: 'PENDING' | 'APPROVED' | 'REJECTED', o: { lifecycle?: string; commentCount?: number } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO public.proposal (id, author_id, title, description, topic, status, lifecycle, moderated_by, comment_count)
              VALUES (${id}, ${AUTHOR}, 'Microondas', 'Más microondas', 'VIDA_UNIVERSITARIA', ${status}, ${o.lifecycle ?? 'ABIERTO'},
                      ${status === 'PENDING' ? null : MOD}, ${o.commentCount ?? 0})`;
  return id;
}

async function row(id: string) {
  const [r] = await t.sql`SELECT * FROM public.proposal WHERE id = ${id}`;
  return r!;
}

async function comment(proposalId: string, authorId: string, parentId: string | null, body: string): Promise<string> {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO public.proposal_comment (id, proposal_id, author_id, parent_id, body) VALUES (${id}, ${proposalId}, ${authorId}, ${parentId}, ${body})`;
  return id;
}

const req = (title: string, description: string, topic: 'EVENTOS' | 'OTROS', attachmentKeys: string[] | null) =>
  ({ title, description, topic, attachmentKeys });
const commentReq = (body: string, parentId: string | null = null) => ({ body, parentId });

describe('ProposalServiceTest', () => {
  // --- Votes -------------------------------------------------------------

  test('voteCastChangeRepeatAndRemoveKeepCountersConsistent', async () => {
    const p = await stored('APPROVED');

    let r = await service.vote(p, ALICE, 'UP');
    expect(r).toEqual({ upCount: 1, downCount: 0, myVote: 'UP' });

    await service.vote(p, BOB, 'UP');
    expect((await row(p)).up_count).toBe(2);

    // Changing the vote moves it between counters.
    r = await service.vote(p, ALICE, 'DOWN');
    expect([r.upCount, r.downCount]).toEqual([1, 1]);

    // Same vote again is a no-op.
    r = await service.vote(p, ALICE, 'DOWN');
    expect([r.upCount, r.downCount]).toEqual([1, 1]);

    r = await service.removeVote(p, ALICE);
    expect(r).toEqual({ upCount: 1, downCount: 0, myVote: null });

    // Removing again is idempotent.
    r = await service.removeVote(p, ALICE);
    expect(r.upCount).toBe(1);
    const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM public.proposal_vote`;
    expect(n).toBe(1);
  });

  test('votingNeedsAnApprovedOpenProposal', async () => {
    const pending = await stored('PENDING');
    // Someone else's pending proposal does not exist for them.
    await expect(service.vote(pending, ALICE, 'UP')).rejects.toBeInstanceOf(ResourceNotFoundError);
    // The author sees it but cannot vote yet.
    await expect(service.vote(pending, AUTHOR, 'UP')).rejects.toBeInstanceOf(InvalidStateError);

    const closed = await stored('APPROVED', { lifecycle: 'CERRADO' });
    await expect(service.vote(closed, ALICE, 'UP')).rejects.toBeInstanceOf(InvalidStateError);
    expect((await row(closed)).up_count).toBe(0);

    await expect(service.vote(crypto.randomUUID(), ALICE, 'UP')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  // --- Aliases and comments ---------------------------------------------

  test('aliasIsStablePerUserAndProposalAndUniqueWithinIt', async () => {
    const p = await stored('APPROVED');
    const other = await stored('APPROVED');

    const a1 = await service.addComment(p, ALICE, commentReq('Hola'));
    const a2 = await service.addComment(p, ALICE, commentReq('De nuevo'));
    const b1 = await service.addComment(p, BOB, commentReq('Chau'));

    expect(a1.alias).not.toBeNull();
    expect(a2.alias).toBe(a1.alias);
    expect(b1.alias).not.toBeNull();
    expect(b1.alias).not.toBe(a1.alias);
    expect(a1.isMine).toBe(true);
    expect(a1.isAuthor).toBe(false);
    const [stable] = await t.sql`SELECT alias FROM public.proposal_alias WHERE proposal_id = ${p} AND user_id = ${ALICE}`;
    expect(stable!.alias).toBe(a1.alias);

    // Aliases are per proposal: the same user gets an independent one elsewhere.
    await service.addComment(other, ALICE, commentReq('Otro'));
    expect((await t.sql`SELECT 1 FROM public.proposal_alias WHERE proposal_id = ${other} AND user_id = ${ALICE}`).length).toBe(1);
    expect((await t.sql`SELECT 1 FROM public.proposal_alias WHERE proposal_id = ${p}`).length).toBe(2);

    expect((await row(p)).comment_count).toBe(3);
    expect((await row(other)).comment_count).toBe(1);
  });

  test('authorCommentIsFlaggedAsAuthor', async () => {
    const p = await stored('APPROVED');
    const c = await service.addComment(p, AUTHOR, commentReq('Soy OP'));
    expect(c.isAuthor).toBe(true);
    expect(c.isMine).toBe(true);
  });

  test('repliesAreOneLevelDeepOnTheSameProposal', async () => {
    const p = await stored('APPROVED');
    const top = await comment(p, BOB, null, 'Top');
    const reply = await comment(p, BOB, top, 'Reply');

    const ok = await service.addComment(p, ALICE, commentReq('Respuesta', top));
    expect(ok.parentId).toBe(top);

    await expect(service.addComment(p, ALICE, commentReq('Anidada', reply))).rejects.toBeInstanceOf(ValidationError);
    await expect(service.addComment(p, ALICE, commentReq('x', crypto.randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    await t.sql`UPDATE public.proposal_comment SET deleted_at = now(), body = NULL WHERE id = ${top}`;
    await expect(service.addComment(p, ALICE, commentReq('x', top))).rejects.toBeInstanceOf(ValidationError);
  });

  test('deletingOwnCommentDecrementsOnceAndOthersGet404', async () => {
    const p = await stored('APPROVED', { commentCount: 1 });
    const mine = await comment(p, ALICE, null, 'Mío');

    await expect(service.deleteOwnComment(p, mine, BOB)).rejects.toBeInstanceOf(ResourceNotFoundError);

    await service.deleteOwnComment(p, mine, ALICE);
    const [c] = await t.sql`SELECT deleted_at, body FROM public.proposal_comment WHERE id = ${mine}`;
    expect(c!.deleted_at).not.toBeNull();
    expect(c!.body).toBeNull();
    expect((await row(p)).comment_count).toBe(0);

    await expect(service.deleteOwnComment(p, mine, ALICE)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect((await row(p)).comment_count).toBe(0);
  });

  // --- Create and visibility --------------------------------------------

  test('createIsPendingWithAuthorAliasAndOnlyOwnAttachmentKeys', async () => {
    const key = (await media.signProposalAttachment(AUTHOR, { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 })).key;
    const alicesKey = (await media.signProposalAttachment(ALICE, { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 })).key;

    const created = await service.create(AUTHOR, req(' Título ', 'Desc', 'EVENTOS', [key]));
    expect(created.status).toBe('PENDING');
    expect(created.lifecycle).toBe('ABIERTO');
    expect(created.title).toBe('Título');
    expect(created.isMine).toBe(true);
    const saved = await t.sql`SELECT object_key, content_type, position FROM public.proposal_attachment WHERE proposal_id = ${created.id}`;
    expect(saved.map((r) => ({ ...r }))).toEqual([{ object_key: key, content_type: 'image/png', position: 0 }]);
    expect(created.attachments).toEqual([{ position: 0, url: `https://media.test/${key}`, contentType: 'image/png' }]);
    expect((await t.sql`SELECT 1 FROM public.proposal_alias WHERE proposal_id = ${created.id} AND user_id = ${AUTHOR}`).length).toBe(1);

    await expect(service.create(AUTHOR, req('T', 'D', 'OTROS', [alicesKey]))).rejects.toBeInstanceOf(ValidationError);
    await expect(service.create(AUTHOR, req('T', 'D', 'OTROS', [key, key]))).rejects.toBeInstanceOf(ValidationError);
    // existsByObjectKeyIn: the key is already attached (to the proposal above).
    await expect(service.create(AUTHOR, req('T', 'D', 'OTROS', [key]))).rejects.toBeInstanceOf(ValidationError);
  });

  test('creatingAndCommentingAreRateLimitedPerUserAfterValidation', async () => {
    const limiter = new UserRateLimiter({ ...t.deps.config.rateLimit, enabled: true, userRules: {
      [CREATE_RATE_RULE]: { capacity: 1, periodMs: 3_600_000 },
      [COMMENT_RATE_RULE]: { capacity: 2, periodMs: 600_000 },
    } });
    const limited = new ProposalService(t.deps, { aliasGenerator: generator(), media, consume: (rule, uid) => limiter.consume(rule, uid) });

    // An invalid create does not burn quota.
    await expect(limited.create(ALICE, req('T', 'D', 'OTROS', ['proposals/not-a-key.png']))).rejects.toBeInstanceOf(ValidationError);
    await limited.create(ALICE, req('T', 'D', 'OTROS', []));
    await expect(limited.create(ALICE, req('T', 'D', 'OTROS', []))).rejects.toBeInstanceOf(RateLimitExceededError);
    await limited.create(BOB, req('T', 'D', 'OTROS', []));

    const p = await stored('APPROVED');
    // Replying to a missing parent does not burn quota either.
    await expect(limited.addComment(p, ALICE, commentReq('x', crypto.randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    await limited.addComment(p, ALICE, commentReq('uno'));
    await limited.addComment(p, ALICE, commentReq('dos'));
    await expect(limited.addComment(p, ALICE, commentReq('tres'))).rejects.toBeInstanceOf(RateLimitExceededError);
    expect((await row(p)).comment_count).toBe(2);
    await limited.addComment(p, BOB, commentReq('otro'));
  });

  test('pendingProposalIsVisibleToAuthorAndModeratorsOnly', async () => {
    const p = await stored('PENDING');
    expect((await service.get(p, AUTHOR, false)).isMine).toBe(true);
    expect((await service.get(p, MOD, true)).isMine).toBe(false);
    await expect(service.get(p, ALICE, false)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.listComments(p, ALICE, false, 1, 20)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  test('rejectionReasonOnlyForAuthorAndModerators', async () => {
    const p = await stored('PENDING');
    await moderation.reject(p, MOD, ' Duplicada ');
    expect((await service.get(p, AUTHOR, false)).rejectionReason).toBe('Duplicada');
    expect((await service.get(p, MOD, true)).rejectionReason).toBe('Duplicada');
  });

  // --- Moderation --------------------------------------------------------

  test('approvePublishesEventOnceAndRefusesToReModerate', async () => {
    const p = await stored('PENDING');
    const res = await moderation.approve(p, MOD);

    expect(res.status).toBe('APPROVED');
    const r = await row(p);
    expect(r.moderated_by).toBe(MOD);
    expect(r.moderated_at).not.toBeNull();
    // OffsetDateTime.now(CLOCK); the Java CLOCK is UTC, ours is the ART ClockConfig.
    expect(res.moderatedAt).toBe('2026-03-01T09:00:00-03:00');
    expect(events).toEqual([{ proposalId: p, authorId: AUTHOR, newStatus: 'APPROVED' }]);

    await expect(moderation.approve(p, MOD)).rejects.toBeInstanceOf(InvalidStateError);

    // Take-down of an approved proposal.
    await moderation.reject(p, MOD, 'Spam');
    expect((await row(p)).status).toBe('REJECTED');
    expect(events).toContainEqual({ proposalId: p, authorId: AUTHOR, newStatus: 'REJECTED' });
    await expect(moderation.reject(p, MOD, 'Again')).rejects.toBeInstanceOf(InvalidStateError);
    await expect(moderation.approve(p, MOD)).rejects.toBeInstanceOf(InvalidStateError);
    expect(events).toHaveLength(2);
  });

  test('lifecycleOnlyOnApprovedAndPublishesOnlyOnChange', async () => {
    const pending = await stored('PENDING');
    await expect(moderation.setLifecycle(pending, MOD, 'CERRADO')).rejects.toBeInstanceOf(InvalidStateError);

    const p = await stored('APPROVED');
    await moderation.setLifecycle(p, MOD, 'ACEPTADO');
    await moderation.setLifecycle(p, MOD, 'ACEPTADO');
    expect((await row(p)).lifecycle).toBe('ACEPTADO');
    expect(events).toEqual([{ proposalId: p, authorId: AUTHOR, newStatus: 'ACEPTADO' }]);
  });

  test('moderatorCommentDeleteDecrementsOnlyOnce', async () => {
    const p = await stored('APPROVED', { commentCount: 1 });
    const c = await comment(p, ALICE, null, 'Spam');

    await moderation.deleteComment(p, c);
    await moderation.deleteComment(p, c);
    const [cr] = await t.sql`SELECT deleted_at FROM public.proposal_comment WHERE id = ${c}`;
    expect(cr!.deleted_at).not.toBeNull();
    expect((await row(p)).comment_count).toBe(0);

    await expect(moderation.deleteComment(p, crypto.randomUUID())).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  test('pagingIsClamped', () => {
    expect(pageable(0, 500).size).toBe(MAX_PAGE_SIZE);
    expect(pageable(-3, 0).page).toBe(0);
    expect(pageable(3, 0).size).toBe(1);
  });
});

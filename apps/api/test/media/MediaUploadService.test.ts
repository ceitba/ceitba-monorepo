// Port of apps/api/src/test/java/org/ceitba/api/service/media/MediaUploadServiceTest.java.
// The per-user rate limit is a capacity fake (the foundation's UserRateLimiter
// is not ported yet): what is tested is that the service consumes only for
// valid requests.
import { describe, expect, test } from 'bun:test';
import { FeatureNotConfiguredError, RateLimitExceededError, ValidationError } from '../../src/http/errors';
import { UnconfiguredObjectStorage, type ObjectStorage, type PresignedUpload } from '../../src/infra/storage';
import { ContentHmac } from '../../src/features/crypto/logic/contentHmac';
import { MB, MediaUploadService, PROPOSAL_ATTACHMENT_RATE_RULE } from '../../src/features/media/logic/mediaUploadService';
import { INTEROP } from '../interop/java-golden';
import { TEST_JWT_SECRET } from '../../contract/support/env';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

interface Call { key: string; contentType: string; length: number }

// Records every signing input.
class RecordingStorage implements ObjectStorage {
  readonly configured = true;
  readonly calls: Call[] = [];
  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedUpload> {
    this.calls.push({ key, contentType, length: contentLength });
    return { uploadUrl: `https://bucket.test/${key}?sig`, headers: { 'Content-Type': contentType },
      expiresAtMicros: Date.parse('2026-01-01T00:10:00Z') * 1000 };
  }
  publicUrl(key: string) { return `https://media.test/${key}`; }
  async put() {}
  async get() { return null; }
  async delete() {}
  async presignGet() { return ''; }
}

function setup(attachmentCapacity: number) {
  const storage = new RecordingStorage();
  const used = new Map<string, number>();
  const consume = (rule: string, userId: string) => {
    if (rule !== PROPOSAL_ATTACHMENT_RATE_RULE) return;
    const n = used.get(userId) ?? 0;
    if (n >= attachmentCapacity) throw new RateLimitExceededError(3600);
    used.set(userId, n + 1);
  };
  const svc = new MediaUploadService(storage, consume, ContentHmac.fromJwtSecret(TEST_JWT_SECRET));
  return { storage, svc };
}

const req = (contentType: string, sizeBytes: number) => ({ filename: 'file', contentType, sizeBytes });

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

const uuidOf = (key: string) => key.slice('proposals/'.length, 'proposals/'.length + 36);
const tagOf = (key: string) => key.slice('proposals/'.length + 37, 'proposals/'.length + 37 + 16);

describe('MediaUploadServiceTest', () => {
  test('staffImage_signsServerChosenKey', async () => {
    const { storage, svc } = setup(10);
    const res = await svc.signStaffImage({ filename: '../../evil.png', contentType: 'Image/PNG', sizeBytes: 2048 });

    expect(res.key).toMatch(/^media\/[0-9a-f-]{36}\.png$/);
    expect(res.method).toBe('PUT');
    expect(res.publicUrl).toBe(`https://media.test/${res.key}`);
    expect(res.uploadUrl.startsWith(`https://bucket.test/${res.key}`)).toBe(true);
    expect(storage.calls).toEqual([{ key: res.key, contentType: 'image/png', length: 2048 }]);
  });

  test('staffImage_rejectsPdfAndOversize', async () => {
    const { storage, svc } = setup(10);
    expect(await rejects(svc.signStaffImage(req('application/pdf', 10)))).toBeInstanceOf(ValidationError);
    expect(await rejects(svc.signStaffImage(req('image/jpeg', 5 * MB + 1)))).toBeInstanceOf(ValidationError);
    expect(storage.calls).toEqual([]);
  });

  test('proposalAttachment_limitsPerType', async () => {
    const { storage, svc } = setup(10);
    await svc.signProposalAttachment(ALICE, req('image/webp', 5 * MB));
    await svc.signProposalAttachment(ALICE, req('application/pdf', 10 * MB));

    expect(await rejects(svc.signProposalAttachment(ALICE, req('image/jpeg', 5 * MB + 1)))).toBeInstanceOf(ValidationError);
    expect(await rejects(svc.signProposalAttachment(ALICE, req('application/pdf', 10 * MB + 1)))).toBeInstanceOf(ValidationError);
    expect(await rejects(svc.signProposalAttachment(ALICE, req('image/gif', 10)))).toBeInstanceOf(ValidationError);
    expect(storage.calls.map((c) => c.contentType)).toEqual(['image/webp', 'application/pdf']);
  });

  test('proposalAttachment_keyIsBoundToItsUploaderWithoutRevealingOrLinkingThem', async () => {
    const { svc } = setup(10);
    const key = (await svc.signProposalAttachment(ALICE, req('application/pdf', 100))).key;

    expect(key).toMatch(/^proposals\/[0-9a-f-]{36}-[0-9a-f]{16}\.pdf$/);
    expect(key).not.toContain(ALICE);
    expect(key).not.toContain(ALICE.replace(/-/g, ''));
    // Two uploads by the same user share no user-derived component.
    const again = (await svc.signProposalAttachment(ALICE, req('image/png', 100))).key;
    expect(tagOf(again)).not.toBe(tagOf(key));
    expect(uuidOf(again)).not.toBe(uuidOf(key));

    expect(svc.proposalAttachmentContentType(ALICE, key)).toBe('application/pdf');
    expect(svc.proposalAttachmentContentType(ALICE, again)).toBe('image/png');
    expect(svc.proposalAttachmentContentType(BOB, key)).toBeNull();
    expect(svc.proposalAttachmentContentType(ALICE, `${key}x`)).toBeNull();
    expect(svc.proposalAttachmentContentType(ALICE, `media/${key}`)).toBeNull();
    expect(svc.proposalAttachmentContentType(ALICE, null)).toBeNull();
    // The tag is bound to the uuid: reusing it on another uuid, or altering it, is rejected.
    const forged = `proposals/${crypto.randomUUID()}-${tagOf(key)}.pdf`;
    expect(svc.proposalAttachmentContentType(ALICE, forged)).toBeNull();
    const at = key.length - 20;
    const flipped = key.slice(0, at) + (key[at] === '0' ? '1' : '0') + key.slice(at + 1);
    expect(svc.proposalAttachmentContentType(ALICE, flipped)).toBeNull();
    // Legacy imported keys are never accepted from users.
    expect(svc.proposalAttachmentContentType(ALICE, 'proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.png')).toBeNull();
  });

  test('proposalAttachment_isRateLimitedPerUser', async () => {
    const { svc } = setup(2);
    await svc.signProposalAttachment(ALICE, req('image/png', 1));
    await svc.signProposalAttachment(ALICE, req('image/png', 1));
    expect(await rejects(svc.signProposalAttachment(ALICE, req('image/png', 1)))).toBeInstanceOf(RateLimitExceededError);
    await svc.signProposalAttachment(BOB, req('image/png', 1));
    // Invalid requests do not burn quota.
    expect(await rejects(svc.signProposalAttachment(BOB, req('image/gif', 1)))).toBeInstanceOf(ValidationError);
    await svc.signProposalAttachment(BOB, req('image/png', 1));
  });

  test('publicUrl_isTheBucketUrlOfTheKey', () => {
    const { svc } = setup(10);
    expect(svc.publicUrl('proposals/x.png')).toBe('https://media.test/proposals/x.png');
    expect(svc.publicUrl('proposals/legacy/x.jpg')).toBe('https://media.test/proposals/legacy/x.jpg');
  });

  test('unconfiguredStorage_answersNotConfigured', () => {
    const unconfigured = new UnconfiguredObjectStorage();
    expect(unconfigured.publicUrl()).toBeNull();
    expect(() => unconfigured.presignPut()).toThrow(FeatureNotConfiguredError);
  });
});

describe('interop: MediaUploadService against Java', () => {
  test('same tag, accepted key and validation messages', async () => {
    const g = INTEROP.media;
    const { svc } = setup(10);
    expect(svc.tagOf(g.user, g.uuid)).toBe(g.tag);
    expect(svc.proposalAttachmentContentType(g.user, g.key)).toBe(g.contentType);
    for (const [type, size, message] of g.errors) {
      const e = await rejects(svc.signProposalAttachment(g.user, req(type, Number(size)))).catch((x) => x);
      expect((e as Error).message).toBe(message);
    }
  });
});

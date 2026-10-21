// Port of apps/api/src/main/java/org/ceitba/api/service/media/MediaUploadService.java.
//
// Validates upload requests and signs direct-to-bucket PUTs. Keys are chosen
// server-side, never from the client's filename:
//   media/{uuid}.{ext}                STAFF CMS images
//   orgs/{slug}/{uuid}.{ext}          org members' images
//   proposals/{uuid}-{tag}.{ext}      proposal attachments
// {tag} = first 16 hex chars of HMAC-SHA256(k, userId ":" uuid), k ContentHmac's
// PROPOSAL_ATTACHMENT_KEYS key: it binds the key to its uploader without
// revealing or linking them (every key has a fresh uuid).
//
// `consume` is deps.userRateLimiter.consume (rules "proposal-attachments" /
// "org-images", RateLimitExceededError when spent; media/service.ts).

import { ValidationError } from '../../../http/errors';
import type { ObjectStorage } from '../../../infra/storage';
import { javaTrim } from '../../../lib/javaCompat';
import { formatInstant } from '../../../lib/time';
import { PROPOSAL_ATTACHMENT_KEYS, type ContentHmac } from '../../crypto/logic/contentHmac';
import { macEquals } from '../../digest/logic/digestUnsubscribeTokens';

export const PROPOSAL_ATTACHMENT_RATE_RULE = 'proposal-attachments';
export const ORG_IMAGE_RATE_RULE = 'org-images';
export const MB = 1024 * 1024;

interface Allowed { ext: string; maxBytes: number }

const STAFF_IMAGE_TYPES = new Map<string, Allowed>([
  ['image/jpeg', { ext: 'jpg', maxBytes: 5 * MB }],
  ['image/png', { ext: 'png', maxBytes: 5 * MB }],
  ['image/webp', { ext: 'webp', maxBytes: 5 * MB }],
]);
const PROPOSAL_TYPES = new Map<string, Allowed>([
  ['image/jpeg', { ext: 'jpg', maxBytes: 5 * MB }],
  ['image/png', { ext: 'png', maxBytes: 5 * MB }],
  ['image/webp', { ext: 'webp', maxBytes: 5 * MB }],
  ['application/pdf', { ext: 'pdf', maxBytes: 10 * MB }],
]);
const PROPOSAL_EXT_TO_TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const PROPOSAL_KEY = /^proposals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{16})\.(jpg|png|webp|pdf)$/;

/** web/media/dto/SignUploadRequest (bound + @Valid'ated by the route). */
export interface SignUploadRequest { filename: string; contentType: string; sizeBytes: number }

/** web/media/dto/SignUploadResponse; expiresAt as Jackson writes an Instant. */
export interface SignUploadResponse {
  uploadUrl: string;
  publicUrl: string | null;
  key: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export type RateConsume = (rule: string, userId: string) => void | Promise<void>;

export class MediaUploadService {
  constructor(private readonly storage: ObjectStorage, private readonly consume: RateConsume, private readonly hmac: ContentHmac) {}

  async signStaffImage(req: SignUploadRequest): Promise<SignUploadResponse> {
    const contentType = normalizeContentType(req.contentType);
    const allowed = check(STAFF_IMAGE_TYPES, contentType, req.sizeBytes);
    return this.sign(`media/${crypto.randomUUID()}.${allowed.ext}`, contentType, req.sizeBytes);
  }

  /** Org members' images: same types and sizes as STAFF images, keyed under the org. */
  async signOrgImage(orgSlug: string, userId: string, req: SignUploadRequest): Promise<SignUploadResponse> {
    const contentType = normalizeContentType(req.contentType);
    const allowed = check(STAFF_IMAGE_TYPES, contentType, req.sizeBytes);
    await this.consume(ORG_IMAGE_RATE_RULE, userId);
    return this.sign(`orgs/${orgSlug}/${crypto.randomUUID()}.${allowed.ext}`, contentType, req.sizeBytes);
  }

  async signProposalAttachment(userId: string, req: SignUploadRequest): Promise<SignUploadResponse> {
    const contentType = normalizeContentType(req.contentType);
    const allowed = check(PROPOSAL_TYPES, contentType, req.sizeBytes);
    await this.consume(PROPOSAL_ATTACHMENT_RATE_RULE, userId);
    const id = crypto.randomUUID();
    return this.sign(`proposals/${id}-${this.tagOf(userId, id)}.${allowed.ext}`, contentType, req.sizeBytes);
  }

  /** Content type of a proposal attachment key signed for `userId`, or null if malformed or someone else's. */
  proposalAttachmentContentType(userId: string, key: string | null | undefined): string | null {
    if (key == null) return null;
    const m = PROPOSAL_KEY.exec(key);
    if (!m) return null;
    const expected = new TextEncoder().encode(this.tagOf(userId, m[1]!));
    if (!macEquals(expected, new TextEncoder().encode(m[2]!))) return null;
    return PROPOSAL_EXT_TO_TYPE[m[3]!]!;
  }

  /** Legacy imported attachments live in the same bucket under proposals/legacy/. */
  publicUrl(key: string): string | null {
    return this.storage.publicUrl(key);
  }

  tagOf(userId: string, keyUuid: string): string {
    return Buffer.from(this.hmac.sign(PROPOSAL_ATTACHMENT_KEYS, `${userId}:${keyUuid}`).subarray(0, 8)).toString('hex');
  }

  private async sign(key: string, contentType: string, sizeBytes: number): Promise<SignUploadResponse> {
    const p = await this.storage.presignPut(key, contentType, sizeBytes);
    return { uploadUrl: p.uploadUrl, publicUrl: this.storage.publicUrl(key), key, method: 'PUT', headers: p.headers,
      expiresAt: formatInstant(p.expiresAtMicros) };
  }
}

function check(allowedTypes: Map<string, Allowed>, contentType: string, sizeBytes: number): Allowed {
  const allowed = allowedTypes.get(contentType);
  if (!allowed) {
    throw new ValidationError('contentType', contentType, `unsupported content type. Allowed: ${[...allowedTypes.keys()].sort().join(', ')}`);
  }
  if (sizeBytes > allowed.maxBytes) {
    throw new ValidationError('sizeBytes', sizeBytes,
      `file too large. Maximum size for ${contentType} is ${Math.floor(allowed.maxBytes / MB)} MB`);
  }
  return allowed;
}

/** "Image/PNG; charset=x" -> "image/png" */
export function normalizeContentType(contentType: string): string {
  const semi = contentType.indexOf(';');
  return javaTrim(semi >= 0 ? contentType.slice(0, semi) : contentType).toLowerCase();
}

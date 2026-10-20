// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestCorrectionVoteTokens.java.
//
// Links of the digest's "¿Es así?" schedule-correction prompts:
// "<userId>.<correctionId>.<expiresAtEpochSeconds>.<base64url HMAC>", keyed
// with ContentHmac's DIGEST_CORRECTION_VOTE purpose key. A token only names who
// may vote on which correction until when; the vote itself is chosen on the
// page and POSTed, never taken from the link.

import type { Clock } from '../../../infra/clock';
import { base64UrlEncode, CANONICAL_UUID, JavaIllegalArgument, javaBase64Decode, javaParseLong, javaSplit } from '../../../lib/javaCompat';
import type { Micros } from '../../../lib/time';
import { DIGEST_CORRECTION_VOTE, type ContentHmac } from '../../crypto/logic/contentHmac';
import { macEquals } from './digestUnsubscribeTokens';

const MESSAGE_PREFIX = 'digest-correction-vote:v1:';

export type VoteTokenVerified =
  | { type: 'Valid'; userId: string; correctionId: string; expiresAt: Micros }
  | { type: 'Expired' }
  | { type: 'Invalid' };

const INVALID: VoteTokenVerified = { type: 'Invalid' };

export class DigestCorrectionVoteTokens {
  /** ttlMs: DigestPersonalProperties.voteTokenTtl. TODO(digest-service): read it from config. */
  constructor(private readonly hmac: ContentHmac, private readonly clock: Clock, private readonly ttlMs: number) {}

  issue(userId: string, correctionId: string): string {
    // Instant.plus(ttl).getEpochSecond(): floor of the instant in seconds.
    const exp = Math.floor((this.clock.now() + this.ttlMs * 1000) / 1_000_000);
    return `${userId}.${correctionId}.${exp}.${base64UrlEncode(this.mac(userId, correctionId, exp))}`;
  }

  /** The MAC is checked before the expiry, so Expired is only ever said of a token we issued. */
  verify(token: string | null | undefined): VoteTokenVerified {
    if (token == null || token.length > 200) return INVALID;
    const parts = javaSplit(token, /\./, -1);
    if (parts.length !== 4) return INVALID;
    const [u, c, e, m] = parts as [string, string, string, string];
    let exp: number;
    let given: Uint8Array;
    try {
      // UUID.fromString(...) + the canonical check below: only lower-case 8-4-4-4-12 passes both.
      if (!CANONICAL_UUID.test(u) || !CANONICAL_UUID.test(c)) return INVALID;
      if (!/^\d{1,12}$/.test(e)) return INVALID;
      exp = javaParseLong(e);
      given = javaBase64Decode(m, true);
    } catch (err) {
      if (err instanceof JavaIllegalArgument) return INVALID;
      throw err;
    }
    if (!macEquals(this.mac(u, c, exp), given)) return INVALID;
    const expiresAt = exp * 1_000_000;
    if (!(this.clock.now() < expiresAt)) return { type: 'Expired' };
    return { type: 'Valid', userId: u, correctionId: c, expiresAt };
  }

  private mac(userId: string, correctionId: string, exp: number): Uint8Array {
    return this.hmac.sign(DIGEST_CORRECTION_VOTE, `${MESSAGE_PREFIX}${userId}:${correctionId}:${exp}`);
  }
}

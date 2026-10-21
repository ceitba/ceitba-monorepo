// service/news/VoteService: fingerprint-deduplicated article votes.

import { createHash } from 'node:crypto';
import { withTx } from '../../db/client';
import type { Db } from '../../db/client';
import type { Deps } from '../../deps';
import { ResourceNotFoundError } from '../../http/errors';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import { ContentHmac, VOTE_FINGERPRINTS } from '../crypto/logic/contentHmac';
import type { VoteResponse } from './dto';
import * as repo from './repo';

const fingerprintInput = (ip: string | null, ua: string | null) => `${ip ?? ''}|${ua ?? ''}`;

/** Unkeyed SHA-256(ip|ua): what vote_records held before the HMAC switch. */
export function legacyFingerprint(ip: string | null, ua: string | null): string {
  return createHash('sha256').update(fingerprintInput(ip, ua), 'utf8').digest('hex');
}

export class VoteService {
  private hmacInstance: ContentHmac | null = null;
  constructor(private readonly deps: Deps) {}

  private get hmac(): ContentHmac {
    this.hmacInstance ??= new ContentHmac(this.deps.config.auth.jwt.secret, this.deps.config.auth.contentHmacSecret);
    return this.hmacInstance;
  }

  fingerprint(ip: string | null, ua: string | null): string {
    return this.hmac.signHex(VOTE_FINGERPRINTS, fingerprintInput(ip, ua));
  }

  async getCounts(articleId: string): Promise<VoteResponse> {
    return withTx(this.deps.db, async (tx) => {
      const v = await repo.findVoteAgg(tx, articleId);
      return { up: v?.upCount ?? 0, down: v?.downCount ?? 0 };
    }, { readOnly: true });
  }

  cast(articleId: string, ip: string | null, ua: string | null, voteType: string): Promise<VoteResponse> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireArticleExists(tx, articleId);
      const fp = this.fingerprint(ip, ua);
      const agg = await this.lockAggregate(tx, articleId);
      const existing = await this.findExisting(tx, articleId, fp, ip, ua);
      if (existing) {
        const legacy = existing.fingerprint !== fp;
        const changed = existing.voteType !== voteType;
        if (changed) {
          retract(agg, existing.voteType);
          increment(agg, voteType);
        }
        if (changed || legacy) {
          await repo.deleteVoteRecord(tx, articleId, existing.fingerprint);
          const createdAt = changed || existing.createdAt === null ? toPgTimestamp(nowMicros()) : existing.createdAt;
          await repo.insertVoteRecord(tx, { articleId, fingerprint: fp, voteType, createdAt });
        }
      } else {
        await repo.insertVoteRecord(tx, { articleId, fingerprint: fp, voteType, createdAt: toPgTimestamp(nowMicros()) });
        increment(agg, voteType);
      }
      await repo.saveVoteAgg(tx, agg);
      return { up: agg.upCount, down: agg.downCount };
    });
  }

  retract(articleId: string, ip: string | null, ua: string | null): Promise<VoteResponse> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireArticleExists(tx, articleId);
      const fp = this.fingerprint(ip, ua);
      const agg = await this.lockAggregate(tx, articleId);
      const record = await this.findExisting(tx, articleId, fp, ip, ua);
      if (!record) throw new ResourceNotFoundError('VoteRecord', articleId);
      retract(agg, record.voteType);
      await repo.deleteVoteRecord(tx, articleId, record.fingerprint);
      await repo.saveVoteAgg(tx, agg);
      return { up: agg.upCount, down: agg.downCount };
    });
  }

  private async requireArticleExists(tx: Db, id: string) {
    if (!(await repo.articleExists(tx, id))) throw new ResourceNotFoundError('Article', id);
  }

  private async lockAggregate(tx: Db, articleId: string): Promise<repo.VoteAggRow> {
    await repo.insertVoteAggIfAbsent(tx, articleId);
    const a = await repo.findVoteAgg(tx, articleId, true);
    if (!a) throw new ResourceNotFoundError('Article', articleId);
    return a;
  }

  private async findExisting(tx: Db, articleId: string, fp: string, ip: string | null, ua: string | null) {
    return (await repo.findVoteRecord(tx, articleId, fp)) ?? repo.findVoteRecord(tx, articleId, legacyFingerprint(ip, ua));
  }
}

const nowMicros = systemNowMicros;

function increment(agg: repo.VoteAggRow, type: string) {
  if (type === 'up') agg.upCount++;
  else agg.downCount++;
  agg.updatedAt = toPgTimestamp(nowMicros());
}

function retract(agg: repo.VoteAggRow, type: string) {
  if (type === 'up') {
    if (agg.upCount > 0) { agg.upCount--; agg.updatedAt = toPgTimestamp(nowMicros()); }
  } else if (agg.downCount > 0) { agg.downCount--; agg.updatedAt = toPgTimestamp(nowMicros()); }
}

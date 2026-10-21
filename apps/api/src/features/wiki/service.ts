// service/wiki/SubjectBookmarkService: subject bookmarks, also the "pinned
// subjects" of /apuntes (max MAX_PER_USER per user).

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { BookmarkLimitError } from '../../http/errors';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros } from '../../lib/time';
import type { BookmarkStateResponse, PinnedSubjectResponse } from './dto';
import * as repo from './repo';

export const MAX_PER_USER = 30;

export class SubjectBookmarkService {
  constructor(private readonly deps: Deps) {}

  /** The user's pinned subjects, most recently pinned first. */
  pinned(userId: string): Promise<PinnedSubjectResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const pins = await repo.pinsOf(tx, userId);
      if (!pins.length) return [];
      const ids = pins.map((p) => p.subjectId);
      const names = await repo.subjectNames(tx, ids);
      const counts = await repo.publishedFileCounts(tx, ids);
      const withWiki = await repo.subjectsWithPublishedPages(tx, ids);
      return pins.map((p) => ({
        subjectId: p.subjectId,
        subjectName: names.get(p.subjectId) ?? null,
        fileCount: counts.get(p.subjectId) ?? 0,
        hasWiki: withWiki.has(p.subjectId),
        pinnedAt: formatOffsetDateTime(parsePgTimestamp(p.updatedAt)),
      }));
    }, { readOnly: true });
  }

  /** @Transactional(readOnly = true); joins the caller's transaction when `db` is one. */
  getState(subjectId: string, userId: string | null, db: Db = this.deps.db): Promise<BookmarkStateResponse> {
    return withTx(db, async (tx) => {
      const count = await repo.countBySubjectId(tx, subjectId);
      const bookmarked = userId !== null && (await repo.exists(tx, subjectId, userId));
      return { count, bookmarked };
    }, { readOnly: true });
  }

  upsert(subjectId: string, userId: string): Promise<BookmarkStateResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.exists(tx, subjectId, userId))) {
        if ((await repo.countByUserId(tx, userId)) >= MAX_PER_USER) throw new BookmarkLimitError(`You can pin at most ${MAX_PER_USER} subjects`);
        await repo.insert(tx, subjectId, userId, systemNowMicros());
      }
      return this.getState(subjectId, userId, tx);
    });
  }

  remove(subjectId: string, userId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (await repo.exists(tx, subjectId, userId)) await repo.deleteBy(tx, subjectId, userId);
    });
  }
}

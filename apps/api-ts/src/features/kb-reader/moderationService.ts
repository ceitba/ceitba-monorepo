// service/kb/KbModerationService: STAFF moderation of subject wikis (the
// StaffKbController routes are kb-admin's) and the hooks Drive calls:
//   hidePagesCiting  takedown, whenever a cited file stops being public
//   forgetFiles      a file row is about to be deleted: takedown plus its digests,
//                    the raw text of its DIGEST requests and the eval sets' frozen
//                    copies of its text (deleted after commit).
// Both hooks take the caller's transaction (`db`), like Java's REQUIRED.

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { systemNowMicros, toPgTimestamp } from '../../lib/time';
import type { KbPageResponse, KbStaffPageResponse, PageResponse } from './dto';
import * as repo from './repo';
import type { KbPageStatus } from './repo';
import { KbViews, staffView } from './views';

export const MAX_LIMIT = 100;
const STATUSES: readonly KbPageStatus[] = ['PUBLISHED', 'HIDDEN', 'REMOVED'];

export class KbModerationService {
  readonly views: KbViews;

  constructor(private readonly deps: Pick<Deps, 'db' | 'config' | 'clock' | 'log' | 'storage'>) {
    this.views = new KbViews(deps);
  }

  /** @Transactional */
  hide(staffId: string, pageId: string): Promise<KbPageResponse> {
    return withTx(this.deps.db, async (tx) => {
      let page = await repo.pageById(tx, pageId);
      if (!page) throw new ResourceNotFoundError('KbPage', pageId);
      if (page.status === 'PUBLISHED') {
        await repo.updatePageState(tx, pageId, { status: 'HIDDEN', hiddenReason: 'STAFF', reportCount: page.reportCount }, toPgTimestamp(systemNowMicros()));
        page = (await repo.pageById(tx, pageId))!;
      }
      return this.views.page(tx, page, staffId, true);
    });
  }

  /** Back to PUBLISHED; its reports are dismissed (count back to 0). @Transactional */
  restore(staffId: string, pageId: string): Promise<KbPageResponse> {
    return withTx(this.deps.db, async (tx) => {
      let page = await repo.pageById(tx, pageId);
      if (!page) throw new ResourceNotFoundError('KbPage', pageId);
      await repo.deleteReportsOfPage(tx, pageId);
      if (page.status !== 'PUBLISHED' || page.hiddenReason != null || page.reportCount !== 0) {
        await repo.updatePageState(tx, pageId, { status: 'PUBLISHED', hiddenReason: null, reportCount: 0 }, toPgTimestamp(systemNowMicros()));
        page = (await repo.pageById(tx, pageId))!;
      }
      return this.views.page(tx, page, staffId, true);
    });
  }

  /** status null: HIDDEN. @Transactional(readOnly = true) */
  async list(status: string | null, page: number, limit: number): Promise<PageResponse<KbStaffPageResponse>> {

    const s = status == null || javaIsBlank(status) ? 'HIDDEN' : javaTrim(status).toUpperCase();
    if (!(STATUSES as readonly string[]).includes(s)) throw new ValidationError('status', status, 'must be PUBLISHED, HIDDEN or REMOVED');
    const st = s as KbPageStatus;
    return withTx(this.deps.db, async (tx) => {
      const r = await repo.pagesByStatus(tx, st, Math.max(page, 0), Math.max(1, Math.min(limit, MAX_LIMIT)));
      return { items: r.rows.map(staffView), total: r.total };
    }, { readOnly: true });
  }

  /** Takedown: every PUBLISHED page citing one of `fileIds` becomes HIDDEN. */
  hidePagesCiting(fileIds: Iterable<string>, db?: Db): Promise<number> {
    const ids = [...fileIds];
    if (ids.length === 0) return Promise.resolve(0);
    return withTx(db ?? this.deps.db, async (tx) => {
      const citing = await repo.publishedCitingAny(tx, ids);
      const now = toPgTimestamp(systemNowMicros());
      for (const p of citing) await repo.updatePageState(tx, p.id, { status: 'HIDDEN', hiddenReason: 'TAKEDOWN', reportCount: p.reportCount }, now);
      if (citing.length > 0) this.deps.log.info(`KB takedown: ${citing.length} pages hidden`);
      return citing.length;
    });
  }

  /**
   * The files are being deleted: pages citing them go hidden, their digests go,
   * the raw text/digest of their DIGEST requests is redacted and the eval sets'
   * frozen copies of their text are deleted after commit. Pass `afterCommit` to
   * hook the storage deletion to the caller's commit (DriveStorageJanitor.
   * deleteAfterCommit); without it the keys are deleted once this call's own
   * transaction commits (or right away when `db` is the caller's transaction).
   */
  async forgetFiles(fileIds: Iterable<string>, db?: Db, afterCommit?: (keys: string[]) => void): Promise<void> {
    const ids = [...fileIds];
    if (ids.length === 0) return;
    const keys = await withTx(db ?? this.deps.db, async (tx) => {
      await this.hidePagesCiting(ids, tx);
      await repo.deleteDigestsOfFiles(tx, ids);
      const idSet = new Set(ids);
      await repo.redactDigestRequests(tx, [...idSet]);
      const out: string[] = [];
      for (const set of await repo.evalSetsFrozen(tx)) {
        const frozen = set.frozenInputs;
        if (frozen == null || typeof frozen !== 'object') continue;
        for (const subject of Object.values(frozen as Record<string, unknown>)) {
          if (subject == null || typeof subject !== 'object') continue;
          for (const input of Object.values(subject as Record<string, unknown>)) {
            const fileId = input != null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).fileId : undefined;
            const text = typeof fileId === 'string' ? fileId : fileId == null || typeof fileId === 'object' ? '' : String(fileId);
            if (idSet.has(text)) out.push(`kb/evals/sets/${set.id}/${text}.txt`);
          }
        }
      }
      return out;
    });
    if (keys.length === 0) return;
    if (afterCommit) { afterCommit(keys); return; }
    for (const key of keys) {
      try {
        await this.deps.storage.delete(key);
      } catch (e) {
        this.deps.log.warn(`Drive sync: could not delete stored object ${key}: ${(e as Error).message}`);
      }
    }
  }
}

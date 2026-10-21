// service/drive/DriveModerationService: STAFF moderation (/v1/staff/drive) plus
// report withdrawal and copy cleanup for account deletion. Staff decisions on
// files (PUBLISH/REMOVE) stick across syncs; restore clears the decision and
// dismisses the reports.

import type { Deps } from '../../deps';
import type { Tx } from '../../db/client';
import { InvalidStateError, ValidationError } from '../../http/errors';
import { javaIsBlank } from '../../lib/javaCompat';
import { DriveJanitor, refOf, releasable } from './blobs';
import type { Ctx } from './context';
import type { PageResponse, StaffFileResponse, StaffReportResponse, StaffSourceResponse, UnclaimedShareResponse } from './dto';
import { fileNotFound, sourceNotFound } from './errors';
import { kbTakedown } from './kbHooks';
import { DRIVE_FILE_KINDS, type DriveFileKind, type DriveStaffDecision } from './logic/types';
import { isFolderFile, PUBLICATIONS, SOURCE_STATUSES, type DriveFile, type DriveSource } from './model';
import type { DriveRecalculator } from './recalculator';
import { inSession, Session, ts } from './session';
import * as repo from './repo';
import { filesOfSource } from './store';
import * as views from './views';

const MAX_LIMIT = 100;
const REPROCESSABLE: DriveFileKind[] = ['DOC', 'SLIDES', 'SHEET', 'DRAWING'];

/** Enum.valueOf(value.trim().toUpperCase(ROOT)), else ValidationException "unknown value". */
function parse<T extends string>(values: readonly T[], field: string, value: string): T {
  const v = value.trim().toUpperCase();
  if ((values as readonly string[]).includes(v)) return v as T;
  throw new ValidationError(field, value, 'unknown value');
}

const blankToNull = (s: string | null | undefined) => (s == null || javaIsBlank(s) ? null : s.trim());
const pageOf = (page: number, limit: number) => ({ offset: Math.max(page, 0) * Math.max(1, Math.min(limit, MAX_LIMIT)), size: Math.max(1, Math.min(limit, MAX_LIMIT)) });

export class DriveModerationService {
  constructor(private readonly deps: Deps, private readonly recalculator: DriveRecalculator, private readonly janitor: DriveJanitor,
              private readonly ctx: Ctx) {}

  /** status null: every source except DISCONNECTED, newest first. */
  sources(status: string | null, page: number, limit: number): Promise<PageResponse<StaffSourceResponse>> {
    return inSession(this.deps.db, async (s) => {
      const p = pageOf(page, limit);
      const filter = status == null || javaIsBlank(status) ? null : parse(SOURCE_STATUSES, 'status', status);
      const items = await repo.staffSourcesPage(s, filter, p.size, p.offset);
      const total = await this.count(items.length, p, () => repo.countStaffSources(s, filter));
      return { items: await views.staffSources(s, items), total };
    }, { readOnly: true });
  }

  /** Spring Data's PageImpl total: the count query is skipped when the first page is not full. */
  private async count(got: number, p: { offset: number; size: number }, total: () => Promise<number>): Promise<number> {
    if (p.offset === 0 && got < p.size) return got;
    if (got > 0 && got < p.size) return p.offset + got;
    return total();
  }

  approve(staffId: string, sourceId: string, comment: string | null): Promise<StaffSourceResponse> {
    return inSession(this.deps.db, async (s) => {
      const source = await this.source(s, sourceId);
      if (source.status === 'DISCONNECTED' || source.status === 'REVOKED') {
        throw new InvalidStateError(`A ${source.status} source cannot be approved`);
      }
      const now = this.deps.clock.now();
      source.status = 'ACTIVE';
      if (source.approvedAt == null) source.approvedAt = now;
      source.reviewedBy = staffId;
      source.reviewedAt = now;
      source.reviewComment = blankToNull(comment);
      await this.recalculator.recompute(s, source, await filesOfSource(s, sourceId));
      return (await views.staffSources(s, [source]))[0]!;
    });
  }

  block(staffId: string, sourceId: string, comment: string | null): Promise<StaffSourceResponse> {
    return inSession(this.deps.db, async (s) => {
      const source = await this.source(s, sourceId);
      if (source.status === 'DISCONNECTED') throw new InvalidStateError('A DISCONNECTED source cannot be blocked');
      const now = this.deps.clock.now();
      source.status = 'BLOCKED';
      source.reviewedBy = staffId;
      source.reviewedAt = now;
      source.reviewComment = blankToNull(comment);
      const all = await filesOfSource(s, sourceId);
      await this.recalculator.recompute(s, source, all);
      await kbTakedown(this.deps).hidePagesCiting(s, all.map((f) => f.id));
      return (await views.staffSources(s, [source]))[0]!;
    });
  }

  /** publication null: NEEDS_REVIEW; files of PENDING_REVIEW sources are left out. */
  files(publication: string | null, page: number, limit: number): Promise<PageResponse<StaffFileResponse>> {
    return inSession(this.deps.db, async (s) => {
      const pub = publication == null || javaIsBlank(publication) ? 'NEEDS_REVIEW' : parse(PUBLICATIONS, 'publication', publication);
      const p = pageOf(page, limit);
      const items = await repo.staffFilesPage(s, pub, p.size, p.offset);
      const total = await this.count(items.length, p, () => repo.countStaffFiles(s, pub));
      return { items: await this.staffFiles(s, items), total };
    }, { readOnly: true });
  }

  publish(fileId: string) {
    return this.decide(fileId, 'PUBLISH', false);
  }

  remove(fileId: string) {
    return this.decide(fileId, 'REMOVE', false);
  }

  restore(fileId: string) {
    return this.decide(fileId, null, true);
  }

  private decide(fileId: string, decision: DriveStaffDecision | null, dismissReports: boolean): Promise<StaffFileResponse> {
    return inSession(this.deps.db, async (s) => {
      const file = await s.fileById(fileId);
      if (!file || isFolderFile(file)) throw fileNotFound(fileId);
      file.staffDecision = decision;
      if (dismissReports) {
        await repo.deleteReportsOfFile(s, fileId);
        file.reportCount = 0;
      }
      const source = await this.source(s, file.sourceId);
      await this.recalculator.recompute(s, source, await filesOfSource(s, source.id));
      if (decision === 'REMOVE') await kbTakedown(this.deps).hidePagesCiting(s, [fileId]);
      return (await this.staffFiles(s, [file]))[0]!;
    });
  }

  /** Re-export every Google-native file of `kind` on a sync queued now. */
  reprocess(kind: string | null): Promise<{ files: number; sources: number }> {
    return inSession(this.deps.db, async (s) => {
      const k = parse(DRIVE_FILE_KINDS, 'kind', kind ?? 'DOC');
      if (!REPROCESSABLE.includes(k)) throw new ValidationError('kind', kind, `must be one of [${REPROCESSABLE.join(', ')}]`);
      const { sourceIds, files } = await repo.markForReexport(s, k);
      for (const id of sourceIds) s.afterCommit(() => this.ctx.trigger.request(id));
      return { files, sources: sourceIds.length };
    });
  }

  unclaimed(): Promise<UnclaimedShareResponse[]> {
    return inSession(this.deps.db, async (s) => (await repo.unclaimedShares(s))
      .map((r) => ({ name: r.name as string, ownerEmail: (r.owner_email as string) ?? null, firstSeenAt: views.odt(ts(r.first_seen_at)),
        lastSeenAt: views.odt(ts(r.last_seen_at)) })), { readOnly: true });
  }

  /** Account deletion: the user's reports go and the files they touched are recounted. */
  withdrawReportsOf(userId: string, session?: Session): Promise<void> {
    return inSession(session ?? this.deps.db, async (s) => {
      const fileIds = await repo.reportedFileIdsOfUser(s, userId);
      if (!fileIds.length) return;
      await repo.deleteReportsOfUser(s, userId);
      const touched = new Set<string>();
      for (const f of await repo.filesByIds(s, fileIds)) {
        f.reportCount = await repo.countReportsOfFile(s, f.id);
        touched.add(f.sourceId);
      }
      if (touched.size) {
        for (const src of await repo.sourcesByIds(s, [...touched])) {
          await this.recalculator.recompute(s, src, await filesOfSource(s, src.id));
        }
      }
    });
  }

  /**
   * Account deletion, before the user's drive sources are deleted (by the
   * account-deletion SQL / FK cascade): withdraws the user's reports, takes down
   * wiki pages citing their files, drops the files' LLM data, and schedules
   * the stored copies of their sources for deletion after commit. Locks the
   * sources first, so a running sync cannot add rows behind it.
   */
  /**
   * prepareAccountDeletion inside the account deletion's transaction `tx` (its own Session, flushed here);
   * returns what runs after the deletion commits (the session's after-commit hooks: stored copies deleted).
   */
  async prepareAccountDeletionIn(tx: Tx, userId: string): Promise<() => Promise<void>> {
    const session = new Session(tx);
    await this.prepareAccountDeletion(userId, session);
    await session.flush();
    return async () => {
      for (const hook of session.afterCommitHooks) await hook();
    };
  }

  prepareAccountDeletion(userId: string, session?: Session): Promise<void> {
    return inSession(session ?? this.deps.db, async (s) => {
      await this.withdrawReportsOf(userId, s);
      const ids = (await repo.lockSourcesOfUser(s, userId)).map((x) => x.id);
      if (!ids.length) return;
      const rows = await repo.filesOfSources(s, ids);
      const rowIds = rows.map((f) => f.id);
      await kbTakedown(this.deps).forgetFiles(s, this.janitor, rowIds);
      this.janitor.deleteAfterCommit(s, await releasable(s, rows.map(refOf), rowIds));
    });
  }

  private async staffFiles(s: Session, page: DriveFile[]): Promise<StaffFileResponse[]> {
    if (!page.length) return [];
    const sourceById = new Map<string, DriveSource>();
    for (const src of await repo.sourcesByIds(s, [...new Set(page.map((f) => f.sourceId))])) sourceById.set(src.id, src);
    const sharers = await views.usersById(s, [...sourceById.values()].map((x) => x.userId));
    const names = await views.subjectNames(s, page.map((f) => f.effectiveSubjectId));
    const reportsByFile = new Map<string, StaffReportResponse[]>();
    for (const r of await repo.reportsOfFiles(s, page.map((f) => f.id))) {
      const id = r.file_id as string;
      if (!reportsByFile.has(id)) reportsByFile.set(id, []);
      reportsByFile.get(id)!.push({ reason: r.reason as string, comment: (r.comment as string) ?? null, createdAt: views.odt(ts(r.created_at)) });
    }
    return page.map((f) => {
      const src = sourceById.get(f.sourceId);
      const sharer = src?.userId == null ? undefined : sharers.get(src.userId);
      return {
        id: f.id, name: f.name, kind: f.kind, sourceId: f.sourceId, sourceRootName: src?.rootName ?? null, ownerEmail: f.ownerEmail,
        sharerName: sharer?.name ?? null, sharerEmail: sharer?.email ?? null, effectiveSubjectId: f.effectiveSubjectId,
        effectiveSubjectName: f.effectiveSubjectId == null ? null : (names.get(f.effectiveSubjectId) ?? null), publication: f.publication,
        reportCount: f.reportCount, reports: reportsByFile.get(f.id) ?? [], driveModifiedAt: views.odt(f.driveModifiedAt),
        academicYear: f.academicYear, academicYearSource: f.academicYearSource,
      };
    });
  }

  private async source(s: Session, id: string): Promise<DriveSource> {
    const src = await s.sourceById(id);
    if (!src) throw sourceNotFound(id);
    return src;
  }
}

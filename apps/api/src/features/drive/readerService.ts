// service/drive/DriveReaderService + DriveStreamer: Apuntes for logged-in
// readers (/v1/wiki/...). Readers see PUBLISHED files only; the source's
// student (files they own) and STAFF may open unpublished ones. Downloads of
// stored copies are 5-minute signed URLs; files kept by reference stream from
// Drive through the bot (capped at DRIVE_SYNC_MAX_FILE_BYTES).

import type { Deps } from '../../deps';
import { DriveApiError } from '../../external/drive';
import type { UserRow } from '../../http/auth/repo';
import { ExternalApiError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank } from '../../lib/javaCompat';
import type { ApuntesSubjectResponse, ReportFileRequest, SubjectFilesResponse } from './dto';
import { fileNotFound, sourceNotFound } from './errors';
import { inlineType as mediaInlineType, PDF } from './logic/driveMedia';
import { normalizeSubjectText } from '../../lib/subjectText';
import { isFolderFile, isCommunity, type DriveFile, type DriveSource } from './model';
import { imageType } from './processor';
import type { DriveSyncProps } from './props';
import type { DriveRecalculator } from './recalculator';
import { inSession, ts, type Session } from './session';
import { filesOfSource } from './store';
import * as repo from './repo';
import * as views from './views';

export const DOWNLOAD_TTL_MS = 5 * 60_000;
const MAX_LIMIT = 100;

export interface StreamRequest { driveId: string; exportMime: string | null; contentType: string; inline: boolean; filename: string; length: number | null }
export type IsStaff = (userId: string | null) => Promise<boolean>;
export interface Download { redirectUrl: string | null; stream: StreamRequest | null }

const pdfName = (name: string) => (name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`);
const eqIc = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const byNameNullsLast = (a: string | null, b: string | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : views.compareIgnoreCase(a, b));

/** Plan entries of one subject. */
interface PlanEntry { subjectId: string; year: number; semester: number; section: string | null }

export class DriveReaderService {
  constructor(private readonly deps: Deps, private readonly props: DriveSyncProps, private readonly recalculator: DriveRecalculator) {}

  private async withWiki(s: Session, items: ApuntesSubjectResponse[]): Promise<ApuntesSubjectResponse[]> {
    if (!items.length) return items;
    const ids = items.map((i) => i.subjectId);
    const withWiki = await repo.subjectsWithPublishedWiki(s, ids);
    return items.map((i) => ({ ...i, hasWiki: withWiki.has(i.subjectId) }));
  }

  private async publishedSubjectsIn(s: Session, ids: string[]): Promise<Map<string, { n: number; last: string | null }>> {
    const out = new Map<string, { n: number; last: string | null }>();
    if (!ids.length) return out;
    for (const r of await repo.publishedStatsOfSubjects(s, ids)) {
      out.set(r.id as string, { n: Number(r.n), last: views.odt(ts(r.last)) });
    }
    return out;
  }

  subjects(q: string | null, limit: number): Promise<ApuntesSubjectResponse[]> {
    return inSession(this.deps.db, async (s) => this.withWiki(s, await this.listSubjects(s, q, limit)), { readOnly: true });
  }

  mySubjects(user: UserRow): Promise<ApuntesSubjectResponse[]> {
    return inSession(this.deps.db, async (s) => this.withWiki(s, await this.listMySubjects(s, user)), { readOnly: true });
  }

  private async listSubjects(s: Session, q: string | null, limit: number): Promise<ApuntesSubjectResponse[]> {
    const n = Math.max(1, Math.min(limit, MAX_LIMIT));
    if (q == null || javaIsBlank(q)) {
      const rows = await repo.recentlyUpdatedSubjects(s, n);
      const names = await views.subjectNames(s, rows.map((r) => r.id as string));
      return rows.map((r) => ({ subjectId: r.id as string, subjectName: names.get(r.id as string) ?? null, fileCount: Number(r.n),
        lastUpdatedAt: views.odt(ts(r.last)), year: null, semester: null, section: null, hasWiki: false }));
    }
    const needle = normalizeSubjectText(q);
    const lowerQ = q.trim().toLowerCase();
    const matching = (await repo.allSubjects(s))
      .map((r) => ({ id: r.id as string, name: r.name as string }))
      .filter((x) => x.id.toLowerCase().includes(lowerQ) || normalizeSubjectText(x.name).includes(needle));
    if (!matching.length) return [];
    const stats = await this.publishedSubjectsIn(s, matching.map((m) => m.id));
    return matching
      .map((m) => {
        const st = stats.get(m.id);
        return { subjectId: m.id, subjectName: m.name, fileCount: st?.n ?? 0, lastUpdatedAt: st?.last ?? null, year: null, semester: null, section: null, hasWiki: false };
      })
      .sort((a, b) => b.fileCount - a.fileCount || views.compareIgnoreCase(a.subjectName, b.subjectName))
      .slice(0, n);
  }

  private async listMySubjects(s: Session, user: UserRow): Promise<ApuntesSubjectResponse[]> {
    if (user.plan == null || javaIsBlank(user.plan)) return [];
    const rows: PlanEntry[] = (await repo.planEntries(s, user.plan))
      .map((r) => ({ subjectId: r.subject_id as string, year: Number(r.year), semester: Number(r.semester), section: (r.section as string) ?? null }));
    if (!rows.length) return [];
    const names = await views.subjectNames(s, rows.map((r) => r.subjectId));
    const bySubject = new Map<string, PlanEntry>();
    for (const e of rows) {
      const a = bySubject.get(e.subjectId);
      bySubject.set(e.subjectId, a ? (a.year > 0 ? a : e) : e);
    }
    const name = (e: PlanEntry) => names.get(e.subjectId) ?? null;
    const entries = [...bySubject.values()].sort((a, b) =>
      Number(a.year <= 0) - Number(b.year <= 0)
      || (a.year > 0 ? a.year : 0) - (b.year > 0 ? b.year : 0)
      || (a.year > 0 ? a.semester : 0) - (b.year > 0 ? b.semester : 0)
      || byNameNullsLast(a.year > 0 ? '' : a.section, b.year > 0 ? '' : b.section)
      || byNameNullsLast(name(a), name(b))
      || (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0));
    const stats = await this.publishedSubjectsIn(s, entries.map((e) => e.subjectId));
    return entries.map((e) => {
      const st = stats.get(e.subjectId);
      return { subjectId: e.subjectId, subjectName: name(e), fileCount: st?.n ?? 0, lastUpdatedAt: st?.last ?? null,
        year: e.year > 0 ? e.year : null, semester: e.semester > 0 ? e.semester : null, section: e.section, hasWiki: false };
    });
  }

  subjectFiles(subjectId: string): Promise<SubjectFilesResponse> {
    return inSession(this.deps.db, async (s) => {
      const subject = await repo.subjectById(s, subjectId);
      if (!subject) throw new ResourceNotFoundError('Subject', subjectId);
      const published = await repo.publishedFilesOfSubject(s, subjectId);
      const sourceIds = [...new Set(published.map((f) => f.sourceId))];
      const sourceById = new Map<string, DriveSource>();
      if (sourceIds.length) for (const src of await repo.sourcesByIds(s, sourceIds)) sourceById.set(src.id, src);
      const owners = await views.usersById(s, [...sourceById.values()].map((x) => x.userId));
      const folders = await views.foldersBySource(s, sourceIds);
      const bySource = new Map<string, DriveFile[]>();
      for (const f of published) {
        if (!bySource.has(f.sourceId)) bySource.set(f.sourceId, []);
        bySource.get(f.sourceId)!.push(f);
      }
      const groups = [];
      for (const [sid, files] of bySource) {
        const src = sourceById.get(sid);
        if (!src) continue;
        const sf = folders.get(sid) ?? new Map();
        const summaries = files.map((f) => views.summary(f, views.path(f, sf), isCommunity(src)))
          .sort((a, b) => views.compareIgnoreCase(a.path, b.path) || views.compareIgnoreCase(a.name, b.name));
        groups.push({ sourceId: src.id, author: views.author(src, src.userId == null ? undefined : owners.get(src.userId)), files: summaries });
      }
      return { subjectId: subject.id as string, subjectName: subject.name as string, groups };
    }, { readOnly: true });
  }

  file(user: UserRow, fileId: string, isStaff: IsStaff) {
    return inSession(this.deps.db, async (s) => {
      const v = await this.visible(s, user, fileId, isStaff);
      const folders = (await views.foldersBySource(s, [v.source.id])).get(v.source.id) ?? new Map();
      const owner = v.source.userId == null ? undefined : (await views.usersById(s, [v.source.userId])).get(v.source.userId);
      const subjectName = v.file.effectiveSubjectId == null ? null : ((await views.subjectNames(s, [v.file.effectiveSubjectId])).get(v.file.effectiveSubjectId) ?? null);
      const reported = (await repo.countReportsOfFileBy(s, fileId, user.id)) > 0;
      return views.detail(v.file, views.path(v.file, folders), subjectName, views.author(v.source, owner), reported);
    }, { readOnly: true });
  }

  download(user: UserRow, fileId: string, variant: string | null, disposition: string | null, isStaff: IsStaff): Promise<Download> {
    return inSession(this.deps.db, async (s) => {
      let inline: boolean;
      if (disposition == null || javaIsBlank(disposition) || eqIc('inline', disposition)) inline = true;
      else if (eqIc('attachment', disposition)) inline = false;
      else throw new ValidationError('disposition', disposition, 'must be inline or attachment');
      const noVariant = variant == null || javaIsBlank(variant);
      if (!noVariant && !eqIc('original', variant!) && !eqIc('pdf', variant!)) throw new ValidationError('variant', variant, 'must be pdf or original');
      const f = (await this.visible(s, user, fileId, isStaff)).file;
      if (views.streamable(f) && f.pdfKey == null && f.originalKey == null) {
        return { redirectUrl: null, stream: this.streamRequest(f, fileId, variant, noVariant, inline) };
      }
      let key: string | null;
      let filename: string;
      if (variant != null && eqIc('original', variant)) {
        key = f.originalKey;
        filename = f.name;
      } else {
        key = f.pdfKey ?? (noVariant ? f.originalKey : null);
        filename = key != null && key === f.pdfKey ? pdfName(f.name) : f.name;
      }
      if (key == null) throw new ResourceNotFoundError('DriveFile download', `${fileId}/${variant}`);
      const isPdf = key === f.pdfKey;
      const storedType = isPdf ? PDF : f.originalContentType;
      const inlineType = isPdf ? PDF : mediaInlineType(storedType, f.name);
      if (inline && inlineType != null) {
        return { redirectUrl: await this.deps.storage.presignGet(key, DOWNLOAD_TTL_MS, { filename, inline: true, contentType: inlineType }), stream: null };
      }
      return { redirectUrl: await this.deps.storage.presignGet(key, DOWNLOAD_TTL_MS, { filename, inline: false, contentType: storedType }), stream: null };
    }, { readOnly: true });
  }

  private streamRequest(f: DriveFile, fileId: string, variant: string | null, noVariant: boolean, inline: boolean): StreamRequest {
    const wantPdf = !(variant != null && eqIc('original', variant)) && (views.hasPdf(f) || !noVariant);
    if (wantPdf) {
      if (!views.hasPdf(f)) throw new ResourceNotFoundError('DriveFile download', `${fileId}/${variant}`);
      const exp = f.kind !== 'PDF';
      return { driveId: f.driveId, exportMime: exp ? PDF : null, contentType: PDF, inline, filename: pdfName(f.name), length: exp ? null : f.sizeBytes };
    }
    if (!views.hasOriginal(f)) throw new ResourceNotFoundError('DriveFile download', `${fileId}/${variant}`);
    const drawing = f.kind === 'DRAWING';
    const inlineType = mediaInlineType(f.originalContentType, f.name);
    const showInline = inline && inlineType != null;
    return { driveId: f.driveId, exportMime: drawing ? 'image/png' : null, contentType: showInline ? inlineType! : 'application/octet-stream',
      inline: showInline, filename: f.name, length: drawing ? null : f.sizeBytes };
  }

  /** DriveStreamer.open: the Drive stream, opened before the response is committed. */
  async openStream(r: StreamRequest): Promise<ReadableStream<Uint8Array>> {
    if (r.length != null && r.length > this.props.maxFileBytes) throw new ResourceNotFoundError('DriveFile download', r.driveId);
    try {
      return r.exportMime == null ? await this.deps.drive.download(r.driveId) : await this.deps.drive.export(r.driveId, r.exportMime);
    } catch (e) {
      if (e instanceof DriveApiError && (e.isNotFoundOrForbidden() || e.isDownloadBlocked() || e.isExportTooLarge())) {
        throw new ResourceNotFoundError('DriveFile download', r.driveId);
      }
      throw new ExternalApiError('Google Drive', r.exportMime == null ? 'files.get' : 'files.export', e);
    }
  }

  /** DriveStreamer.copy: at most maxFileBytes, then the response is cut. */
  capStream(input: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const max = this.props.maxFileBytes;
    let total = 0;
    return input.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        total += chunk.length;
        if (total > max) {
          ctrl.error(new Error('Drive stream larger than DRIVE_SYNC_MAX_FILE_BYTES'));
          return;
        }
        ctrl.enqueue(chunk);
      },
    }));
  }

  assetUrl(user: UserRow, fileId: string, name: string, isStaff: IsStaff): Promise<string> {
    return inSession(this.deps.db, async (s) => {
      const f = (await this.visible(s, user, fileId, isStaff)).file;
      if (f.assetPrefix == null || !f.assetNames.includes(name)) throw new ResourceNotFoundError('DriveFile asset', `${fileId}/${name}`);
      return this.deps.storage.presignGet(f.assetPrefix + name, DOWNLOAD_TTL_MS, { filename: name, inline: true, contentType: imageType(name) });
    }, { readOnly: true });
  }

  report(user: UserRow, fileId: string, req: ReportFileRequest): Promise<void> {
    return inSession(this.deps.db, async (s) => {
      const f = await s.fileById(fileId);
      if (!f) throw fileNotFound(fileId);
      if (f.publication !== 'PUBLISHED' && f.publication !== 'HIDDEN_REPORTED') throw fileNotFound(fileId);
      const now = views.odt(this.deps.clock.now());
      const comment = req.comment == null || javaIsBlank(req.comment) ? null : req.comment.trim();
      await repo.upsertReport(s, fileId, user.id, req.reason, comment, now);
      f.reportCount = await repo.countReportsOfFile(s, fileId);
      const source = await s.sourceById(f.sourceId);
      if (!source) throw sourceNotFound(f.sourceId);
      await this.recalculator.recompute(s, source, await filesOfSource(s, source.id));
    });
  }

  private async visible(s: Session, user: UserRow, fileId: string, isStaff: IsStaff): Promise<{ file: DriveFile; source: DriveSource }> {
    const f = await s.fileById(fileId);
    if (!f) throw fileNotFound(fileId);
    const source = await s.sourceById(f.sourceId);
    if (!source) throw fileNotFound(fileId);
    if (!(await canView(user.id, f, source, isStaff))) throw fileNotFound(fileId);
    return { file: f, source };
  }

}

/** DriveAccess.canView */
async function canView(userId: string | null, f: DriveFile, source: DriveSource, isStaff: IsStaff): Promise<boolean> {
  if (isFolderFile(f)) return false;
  if (f.publication === 'PUBLISHED') return true;
  if (userId != null && userId === source.userId && f.ownedBySharer) return true;
  return isStaff(userId);
}

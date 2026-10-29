// The Hibernate session the drive services rely on, small: one per
// transaction, an identity map of the DriveFile / DriveSource /
// DriveSourceWalk rows loaded in it, dirty checking, and a flush that writes
// inserts, then updates (every column, @UpdateTimestamp bumped only on rows
// that changed), then deletes, before every query (FlushMode AUTO) and at
// commit. afterCommit() is TransactionSynchronization.afterCommit (janitor
// deletions, queued syncs): run once the outermost transaction committed.
//
// Java mutates loaded entities and lets the flush write them (DriveRecalculator
// changes every row of a source in memory); queries after a change see it
// (auto flush) and return the same instances (identity map). Porting that
// literally keeps every service a line-by-line port.

import { sql, type SQL } from 'drizzle-orm';
import type { Database, Db, Tx } from '../../db/client';
import { withTx } from '../../db/client';
import { parsePgTimestamp, systemNowMicros, toPgTimestamp, type Micros } from '../../lib/time';
import type { DriveFile, DriveSource, DriveSourceWalk } from './model';

interface Entry<T> { e: T; snap: string | null; deleted: boolean }

type Row = Record<string, unknown>;

export const ts = (v: unknown): Micros | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime() * 1000;
  return parsePgTimestamp(String(v));
};
const pgTs = (us: Micros | null) => (us == null ? null : toPgTimestamp(us));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const json = (v: unknown): string[] => (v == null ? [] : typeof v === 'string' ? (JSON.parse(v) as string[]) : (v as string[]));

export function fileFromRow(r: Row): DriveFile {
  return {
    id: r.id as string, sourceId: r.source_id as string, driveId: r.drive_id as string, parentDriveId: (r.parent_drive_id as string) ?? null,
    name: r.name as string, mimeType: r.mime_type as string, kind: r.kind as DriveFile['kind'], ownerEmail: (r.owner_email as string) ?? null,
    ownedBySharer: !!r.owned_by_sharer, driveVersion: num(r.drive_version), md5Checksum: (r.md5_checksum as string) ?? null,
    sizeBytes: num(r.size_bytes), driveModifiedAt: ts(r.drive_modified_at), driveCreatedAt: ts(r.drive_created_at),
    academicYearUser: num(r.academic_year_user), academicYear: num(r.academic_year),
    academicYearSource: (r.academic_year_source as DriveFile['academicYearSource']) ?? null, subjectId: (r.subject_id as string) ?? null,
    effectiveSubjectId: (r.effective_subject_id as string) ?? null, suggestedSubjectId: (r.suggested_subject_id as string) ?? null,
    hidden: !!r.hidden, hiddenByUser: !!r.hidden_by_user, publication: r.publication as DriveFile['publication'],
    staffDecision: (r.staff_decision as DriveFile['staffDecision']) ?? null, publishedAt: ts(r.published_at),
    reportCount: Number(r.report_count), contentVersion: num(r.content_version), contentFingerprint: (r.content_fingerprint as string) ?? null,
    contentModifiedAt: ts(r.content_modified_at), htmlContent: (r.html_content as string) ?? null, pdfKey: (r.pdf_key as string) ?? null,
    originalKey: (r.original_key as string) ?? null, originalContentType: (r.original_content_type as string) ?? null,
    assetPrefix: (r.asset_prefix as string) ?? null, assetNames: json(r.asset_names), textContent: (r.text_content as string) ?? null,
    metadataOnly: !!r.metadata_only, exportBlocked: !!r.export_blocked, byReference: !!r.by_reference,
    seenGeneration: num(r.seen_generation), syncError: (r.sync_error as string) ?? null, removedAt: ts(r.removed_at),
    purgeAfter: ts(r.purge_after), createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  };
}

export function sourceFromRow(r: Row): DriveSource {
  return {
    id: r.id as string, userId: (r.user_id as string) ?? null, kind: r.kind as DriveSource['kind'], displayName: (r.display_name as string) ?? null,
    storageMode: r.storage_mode as DriveSource['storageMode'], subjectId: (r.subject_id as string) ?? null,
    parentSourceId: (r.parent_source_id as string) ?? null, ownerEmail: (r.owner_email as string) ?? null,
    rootFolderId: r.root_folder_id as string, rootName: r.root_name as string, status: r.status as DriveSource['status'],
    anonymous: !!r.anonymous, consentVersion: r.consent_version as string, consentedAt: ts(r.consented_at)!,
    approvedAt: ts(r.approved_at), reviewedBy: (r.reviewed_by as string) ?? null, reviewedAt: ts(r.reviewed_at),
    reviewComment: (r.review_comment as string) ?? null, lastSyncedAt: ts(r.last_synced_at), lastSyncRequestedAt: ts(r.last_sync_requested_at),
    lastError: (r.last_error as string) ?? null, consecutiveFailures: Number(r.consecutive_failures), createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  };
}

export function walkFromRow(r: Row): DriveSourceWalk {
  return {
    sourceId: r.source_id as string, generation: Number(r.generation), startedAt: ts(r.started_at), completedAt: ts(r.completed_at),
    frontier: json(r.frontier), rootAncestors: json(r.root_ancestors), incomplete: !!r.incomplete, warning: (r.warning as string) ?? null,
    updatedAt: ts(r.updated_at),
  };
}

const snapshot = (e: object) => JSON.stringify({ ...e, updatedAt: undefined });

export class Session {
  private readonly files = new Map<string, Entry<DriveFile>>();
  private readonly sources = new Map<string, Entry<DriveSource>>();
  private readonly walks = new Map<string, Entry<DriveSourceWalk>>();
  readonly afterCommitHooks: (() => unknown)[] = [];

  constructor(readonly tx: Tx) {}

  /** TransactionSynchronization.afterCommit. */
  afterCommit(fn: () => unknown): void {
    this.afterCommitHooks.push(fn);
  }

  // ---- raw queries (after an auto flush) ---------------------------------------

  async rows(q: SQL): Promise<Row[]> {
    await this.flush();
    return [...(await this.tx.execute(q))] as Row[];
  }

  // ---- managed loading ----------------------------------------------------------

  private manage<T extends { id?: string; sourceId?: string }>(map: Map<string, Entry<T>>, key: string, fresh: T): T {
    const cur = map.get(key);
    if (cur && !cur.deleted) return cur.e;
    map.set(key, { e: fresh, snap: snapshot(fresh), deleted: false });
    return fresh;
  }

  async queryFiles(where: SQL, tail: SQL = sql``): Promise<DriveFile[]> {
    const rs = await this.rows(sql`SELECT f.* FROM wiki.drive_file f WHERE ${where} ${tail}`);
    return rs.map((r) => this.manage(this.files, r.id as string, fileFromRow(r)));
  }

  async querySources(where: SQL, tail: SQL = sql``): Promise<DriveSource[]> {
    const rs = await this.rows(sql`SELECT s.* FROM wiki.drive_source s WHERE ${where} ${tail}`);
    return rs.map((r) => this.manage(this.sources, r.id as string, sourceFromRow(r)));
  }

  async fileById(id: string): Promise<DriveFile | null> {
    const m = this.files.get(id);
    if (m) return m.deleted ? null : m.e;
    return (await this.queryFiles(sql`f.id = ${id}`))[0] ?? null;
  }

  async sourceById(id: string, forUpdate = false): Promise<DriveSource | null> {
    const m = this.sources.get(id);
    if (m && !forUpdate) return m.deleted ? null : m.e;
    return (await this.querySources(sql`s.id = ${id}`, forUpdate ? sql`FOR UPDATE` : sql``))[0] ?? null;
  }

  async walk(sourceId: string): Promise<DriveSourceWalk | null> {
    const m = this.walks.get(sourceId);
    if (m) return m.deleted ? null : m.e;
    const [r] = await this.rows(sql`SELECT * FROM wiki.drive_source_walk WHERE source_id = ${sourceId}`);
    return r ? this.manage(this.walks, sourceId, walkFromRow(r)) : null;
  }

  // ---- persist / delete -----------------------------------------------------------

  persistFile(f: DriveFile): DriveFile {
    this.files.set(f.id, { e: f, snap: null, deleted: false });
    return f;
  }

  persistSource(s: DriveSource): DriveSource {
    this.sources.set(s.id, { e: s, snap: null, deleted: false });
    return s;
  }

  /** walks.save: inserts a new walk, or keeps tracking a loaded one. */
  saveWalk(w: DriveSourceWalk): void {
    const m = this.walks.get(w.sourceId);
    if (m && m.e === w && !m.deleted) return;
    this.walks.set(w.sourceId, { e: w, snap: null, deleted: false });
  }

  deleteFile(f: DriveFile): void {
    const m = this.files.get(f.id);
    if (m) m.deleted = true;
    else this.files.set(f.id, { e: f, snap: snapshot(f), deleted: true });
  }

  deleteWalk(w: DriveSourceWalk): void {
    const m = this.walks.get(w.sourceId);
    if (m) m.deleted = true;
  }

  // ---- flush ----------------------------------------------------------------------

  async flush(): Promise<void> {
    const now = systemNowMicros();
    const tx = this.tx;
    // inserts (sources, walks, files: FK order)
    for (const [, m] of this.sources) if (m.snap === null && !m.deleted) await insertSource(tx, m, now);
    for (const [, m] of this.walks) if (m.snap === null && !m.deleted) await upsertWalk(tx, m, now);
    for (const [, m] of this.files) if (m.snap === null && !m.deleted) await insertFile(tx, m, now);
    // updates
    for (const [, m] of this.sources) if (m.snap !== null && !m.deleted && snapshot(m.e) !== m.snap) await updateSource(tx, m, now);
    for (const [, m] of this.walks) if (m.snap !== null && !m.deleted && snapshot(m.e) !== m.snap) await upsertWalk(tx, m, now);
    for (const [, m] of this.files) if (m.snap !== null && !m.deleted && snapshot(m.e) !== m.snap) await updateFile(tx, m, now);
    // deletes
    for (const [id, m] of this.files) {
      if (!m.deleted) continue;
      if (m.snap !== null) await tx.execute(sql`DELETE FROM wiki.drive_file WHERE id = ${id}`);
      this.files.delete(id);
    }
    for (const [id, m] of this.walks) {
      if (!m.deleted) continue;
      if (m.snap !== null) await tx.execute(sql`DELETE FROM wiki.drive_source_walk WHERE source_id = ${id}`);
      this.walks.delete(id);
    }
  }
}

async function insertSource(tx: Tx, m: Entry<DriveSource>, now: Micros) {
  const s = m.e;
  s.createdAt ??= now;
  s.updatedAt = now;
  await tx.execute(sql`INSERT INTO wiki.drive_source (id, user_id, kind, display_name, storage_mode, subject_id, parent_source_id,
      owner_email, root_folder_id, root_name, status, anonymous, consent_version, consented_at, approved_at, reviewed_by, reviewed_at,
      review_comment, last_synced_at, last_sync_requested_at, last_error, consecutive_failures, created_at, updated_at)
    VALUES (${s.id}, ${s.userId}, ${s.kind}, ${s.displayName}, ${s.storageMode}, ${s.subjectId}, ${s.parentSourceId}, ${s.ownerEmail},
      ${s.rootFolderId}, ${s.rootName}, ${s.status}, ${s.anonymous}, ${s.consentVersion}, ${pgTs(s.consentedAt)}, ${pgTs(s.approvedAt)},
      ${s.reviewedBy}, ${pgTs(s.reviewedAt)}, ${s.reviewComment}, ${pgTs(s.lastSyncedAt)}, ${pgTs(s.lastSyncRequestedAt)}, ${s.lastError},
      ${s.consecutiveFailures}, ${pgTs(s.createdAt)}, ${pgTs(s.updatedAt)})`);
  m.snap = snapshot(s);
}

async function updateSource(tx: Tx, m: Entry<DriveSource>, now: Micros) {
  const s = m.e;
  s.updatedAt = now;
  await tx.execute(sql`UPDATE wiki.drive_source SET user_id = ${s.userId}, kind = ${s.kind}, display_name = ${s.displayName},
      storage_mode = ${s.storageMode}, subject_id = ${s.subjectId}, parent_source_id = ${s.parentSourceId}, owner_email = ${s.ownerEmail},
      root_folder_id = ${s.rootFolderId}, root_name = ${s.rootName}, status = ${s.status}, anonymous = ${s.anonymous},
      consent_version = ${s.consentVersion}, consented_at = ${pgTs(s.consentedAt)}, approved_at = ${pgTs(s.approvedAt)},
      reviewed_by = ${s.reviewedBy}, reviewed_at = ${pgTs(s.reviewedAt)}, review_comment = ${s.reviewComment},
      last_synced_at = ${pgTs(s.lastSyncedAt)}, last_sync_requested_at = ${pgTs(s.lastSyncRequestedAt)}, last_error = ${s.lastError},
      consecutive_failures = ${s.consecutiveFailures}, updated_at = ${pgTs(s.updatedAt)}
    WHERE id = ${s.id}`);
  m.snap = snapshot(s);
}

async function upsertWalk(tx: Tx, m: Entry<DriveSourceWalk>, now: Micros) {
  const w = m.e;
  w.updatedAt = now;
  await tx.execute(sql`INSERT INTO wiki.drive_source_walk (source_id, generation, started_at, completed_at, frontier, root_ancestors,
      incomplete, warning, updated_at)
    VALUES (${w.sourceId}, ${w.generation}, ${pgTs(w.startedAt)}, ${pgTs(w.completedAt)}, CAST(${JSON.stringify(w.frontier)} AS jsonb),
      CAST(${JSON.stringify(w.rootAncestors)} AS jsonb), ${w.incomplete}, ${w.warning}, ${pgTs(w.updatedAt)})
    ON CONFLICT (source_id) DO UPDATE SET generation = EXCLUDED.generation, started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at, frontier = EXCLUDED.frontier, root_ancestors = EXCLUDED.root_ancestors,
      incomplete = EXCLUDED.incomplete, warning = EXCLUDED.warning, updated_at = EXCLUDED.updated_at`);
  m.snap = snapshot(w);
}

function fileValues(f: DriveFile): SQL {
  return sql`${f.sourceId}, ${f.driveId}, ${f.parentDriveId}, ${f.name}, ${f.mimeType}, ${f.kind}, ${f.ownerEmail}, ${f.ownedBySharer},
    ${f.driveVersion}, ${f.md5Checksum}, ${f.sizeBytes}, ${pgTs(f.driveModifiedAt)}, ${pgTs(f.driveCreatedAt)}, ${f.academicYearUser},
    ${f.academicYear}, ${f.academicYearSource}, ${f.subjectId}, ${f.effectiveSubjectId}, ${f.suggestedSubjectId}, ${f.hidden},
    ${f.hiddenByUser}, ${f.publication}, ${f.staffDecision}, ${pgTs(f.publishedAt)}, ${f.reportCount}, ${f.contentVersion},
    ${f.contentFingerprint}, ${pgTs(f.contentModifiedAt)}, ${f.htmlContent}, ${f.pdfKey}, ${f.originalKey}, ${f.originalContentType},
    ${f.assetPrefix}, CAST(${JSON.stringify(f.assetNames)} AS jsonb), ${f.textContent}, ${f.metadataOnly}, ${f.exportBlocked},
    ${f.byReference}, ${f.seenGeneration}, ${f.syncError}, ${pgTs(f.removedAt)}, ${pgTs(f.purgeAfter)}`;
}

const FILE_COLUMNS = sql.raw(`source_id, drive_id, parent_drive_id, name, mime_type, kind, owner_email, owned_by_sharer, drive_version,
  md5_checksum, size_bytes, drive_modified_at, drive_created_at, academic_year_user, academic_year, academic_year_source, subject_id,
  effective_subject_id, suggested_subject_id, hidden, hidden_by_user, publication, staff_decision, published_at, report_count,
  content_version, content_fingerprint, content_modified_at, html_content, pdf_key, original_key, original_content_type, asset_prefix,
  asset_names, text_content, metadata_only, export_blocked, by_reference, seen_generation, sync_error, removed_at, purge_after`);

async function insertFile(tx: Tx, m: Entry<DriveFile>, now: Micros) {
  const f = m.e;
  f.createdAt ??= now;
  f.updatedAt = now;
  await tx.execute(sql`INSERT INTO wiki.drive_file (id, ${FILE_COLUMNS}, created_at, updated_at)
    VALUES (${f.id}, ${fileValues(f)}, ${pgTs(f.createdAt)}, ${pgTs(f.updatedAt)})`);
  m.snap = snapshot(f);
}

async function updateFile(tx: Tx, m: Entry<DriveFile>, now: Micros) {
  const f = m.e;
  f.updatedAt = now;
  await tx.execute(sql`UPDATE wiki.drive_file SET (${FILE_COLUMNS}, updated_at) = (${fileValues(f)}, ${pgTs(f.updatedAt)}) WHERE id = ${f.id}`);
  m.snap = snapshot(f);
}

/**
 * @Transactional with a session: runs `fn`, flushes, commits, then runs the
 * after-commit hooks (outside the transaction). A Session passed in joins it
 * (REQUIRED propagation).
 */
export async function inSession<T>(db: Db | Session, fn: (s: Session) => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
  if (db instanceof Session) return fn(db);
  let session: Session | null = null;
  const result = await withTx(db as Database, async (tx) => {
    session = new Session(tx);
    const r = await fn(session);
    await session.flush();
    return r;
  }, opts);
  for (const hook of (session as Session | null)?.afterCommitHooks ?? []) {
    try {
      await hook();
    } catch {
      // after-commit work is best effort (Spring logs and swallows it too)
    }
  }
  return result;
}

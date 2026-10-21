// service/drive/DriveSyncStore: the short transactions of a sync
// (DriveSyncService does the Drive and storage I/O between them, never inside
// a transaction). See the Java class comment for the diff rules, cross-source
// moves and the row lock that keeps a disconnect/block/account deletion from
// being undone by a running sync.

import { sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { firstOwner, ownedBy, type DriveItem } from '../../external/drive';
import { toPgTimestamp, type Micros } from '../../lib/time';
import { DriveJanitor, refOf, releasable, type BlobRef } from './blobs';
import { forgetFiles } from './kbHooks';
import { byReference, needsFetch, REF } from './logic/driveSyncRules';
import type { DriveFileKind } from './logic/types';
import {
  applyHiddenDefault, communitySource, hasContent, isCommunity, isRemovedFromDrive, markIncomplete, newDriveFile, newWalk,
  setContent, startWalk, type DriveFile, type DriveSource, type DriveSourceStatus,
} from './model';
import type { DriveSyncProps } from './props';
import type { DriveRecalculator } from './recalculator';
import { inSession, ts, type Session } from './session';
import { entry, walkDone, type WalkedItem, type WalkResult } from './walker';

export const MAX_CONSECUTIVE_FAILURES = 5;
export const PURGE_DELAY_US = 30 * 86_400_000_000;
export const MAX_ERROR_CHARS = 1000;
const SYNCABLE: DriveSourceStatus[] = ['ACTIVE', 'PENDING_REVIEW', 'ERROR'];

export interface Snapshot { id: string; rootFolderId: string; ownerEmail: string | null; status: DriveSourceStatus; community: boolean; communityRootFolderId: string | null }
export interface WalkState { generation: number; frontier: string[]; seen: string[]; rootAncestors: string[] }
export interface FetchTask {
  fileId: string; driveId: string; kind: DriveFileKind; name: string; mimeType: string; version: number | null;
  knownFingerprint: string | null; size: number | null; modifiedAt: Micros | null; reference: boolean;
}

/** DriveContentProcessor.Content */
export interface Content {
  version: number | null; fingerprint: string; html: string | null; pdfKey: string | null; originalKey: string | null;
  originalContentType: string | null; assetPrefix: string | null; assetNames: string[]; text: string | null; metadataOnly: boolean;
  existing: boolean; exportBlocked: boolean; byReference: boolean;
}

export const truncate = (s: string | null) => (s == null ? null : s.length <= MAX_ERROR_CHARS ? s : s.slice(0, MAX_ERROR_CHARS));
const writable = (s: DriveSource) => s.status !== 'DISCONNECTED' && s.status !== 'BLOCKED';

/** After a clean, complete generation: a live row it did not reach. */
export const removable = (f: Pick<DriveFile, 'removedAt' | 'seenGeneration'>, generation: number) =>
  f.removedAt == null && (f.seenGeneration == null || f.seenGeneration !== generation);

/** The object keys a processed copy uploaded (same rule as DriveFile.storageKeys). */
export function keysOf(c: Pick<Content, 'pdfKey' | 'originalKey' | 'assetPrefix' | 'assetNames'>): string[] {
  const keys: string[] = [];
  if (c.pdfKey != null) keys.push(c.pdfKey);
  if (c.originalKey != null && c.originalKey !== c.pdfKey) keys.push(c.originalKey);
  if (c.assetPrefix != null) for (const n of c.assetNames) keys.push(c.assetPrefix + n);
  return keys;
}

const uuids = (ids: string[]) => sql`(${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;

export async function userEmail(s: Session, userId: string | null): Promise<string | null> {
  if (userId == null) return null;
  const [u] = await s.rows(sql`SELECT email FROM public."user" WHERE id = ${userId}`);
  return (u?.email as string) ?? null;
}

export const filesOfSource = (s: Session, sourceId: string) => s.queryFiles(sql`f.source_id = ${sourceId}`);

export class DriveSyncStore {
  constructor(private readonly deps: Deps, private readonly props: DriveSyncProps, private readonly recalculator: DriveRecalculator,
              private readonly janitor: DriveJanitor) {}

  private get db() {
    return this.deps.db;
  }

  private now(): Micros {
    return this.deps.clock.now();
  }

  /** Never-synced first, then oldest sync; community roots are never walked. */
  idsToSync(): Promise<string[]> {
    return inSession(this.db, async (s) => (await s.rows(sql`SELECT id FROM wiki.drive_source
        WHERE status IN ('ACTIVE', 'PENDING_REVIEW', 'ERROR') AND kind <> 'COMMUNITY_ROOT'
        ORDER BY last_synced_at ASC NULLS FIRST, created_at ASC`)).map((r) => r.id as string), { readOnly: true });
  }

  /** Manual syncs may also retry a REVOKED source. */
  snapshot(sourceId: string, allowRevoked: boolean): Promise<Snapshot | null> {
    return inSession(this.db, async (s) => {
      const src = await s.sourceById(sourceId);
      if (!src || src.kind === 'COMMUNITY_ROOT') return null;
      if (!(SYNCABLE.includes(src.status) || (allowRevoked && src.status === 'REVOKED'))) return null;
      if (isCommunity(src)) {
        const root = src.parentSourceId == null ? null : await s.sourceById(src.parentSourceId);
        return { id: src.id, rootFolderId: src.rootFolderId, ownerEmail: src.ownerEmail, status: src.status, community: true, communityRootFolderId: root?.rootFolderId ?? null };
      }
      return { id: src.id, rootFolderId: src.rootFolderId, ownerEmail: await userEmail(s, src.userId), status: src.status, community: false, communityRootFolderId: null };
    }, { readOnly: true });
  }

  resumeWalk(sourceId: string): Promise<WalkState | null> {
    return inSession(this.db, async (s) => {
      const w = await s.walk(sourceId);
      if (!w || w.completedAt != null) return null;
      const seen = (await s.rows(sql`SELECT drive_id FROM wiki.drive_file WHERE source_id = ${sourceId} AND seen_generation = ${w.generation}`))
        .map((r) => r.drive_id as string);
      return { generation: w.generation, frontier: [...w.frontier], seen, rootAncestors: [...w.rootAncestors] };
    }, { readOnly: true });
  }

  startWalk(sourceId: string, rootFolderId: string, rootAncestors: string[]): Promise<WalkState> {
    return inSession(this.db, async (s) => {
      const walk = (await s.walk(sourceId)) ?? newWalk(sourceId);
      const generation = walk.generation + 1;
      startWalk(walk, generation, this.now(), [entry(0, rootFolderId)], rootAncestors);
      s.saveWalk(walk);
      return { generation, frontier: [...walk.frontier], seen: [], rootAncestors: [...walk.rootAncestors] };
    });
  }

  /** The bot lost access to the root: nothing stays published. */
  markRevoked(sourceId: string, error: string): Promise<void> {
    return inSession(this.db, async (s) => {
      const src = await s.sourceById(sourceId);
      if (!src || src.status === 'DISCONNECTED' || src.status === 'BLOCKED') return;
      src.status = 'REVOKED';
      src.lastError = truncate(error);
      src.lastSyncedAt = this.now();
      await this.recalculator.recompute(s, src, await filesOfSource(s, sourceId));
    });
  }

  recordFailure(sourceId: string, error: string): Promise<void> {
    return inSession(this.db, async (s) => {
      const src = await s.sourceById(sourceId);
      if (!src) return;
      src.lastError = truncate(error);
      src.consecutiveFailures++;
      if (src.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && SYNCABLE.includes(src.status)) src.status = 'ERROR';
    });
  }

  isSyncable(sourceId: string): Promise<boolean> {
    return inSession(this.db, async (s) => {
      const src = await s.sourceById(sourceId);
      return !!src && writable(src);
    }, { readOnly: true });
  }

  /** Applies one walk slice; false (nothing applied) when the source is gone or no longer writable. */
  applyWalk(sourceId: string, rootName: string | null, slice: WalkResult, generation: number): Promise<boolean> {
    return inSession(this.db, async (s) => {
      const source = await s.sourceById(sourceId, true);
      if (!source || !writable(source)) return false;
      if (rootName != null && rootName !== source.rootName) source.rootName = rootName;
      const walk = (await s.walk(sourceId)) ?? newWalk(sourceId);
      if (walk.generation !== generation) return false;
      const now = this.now();
      const community = isCommunity(source);
      const ownerEmail = community ? source.ownerEmail : await userEmail(s, source.userId);

      const existing = new Map<string, DriveFile>();
      for (const f of await filesOfSource(s, sourceId)) existing.set(f.driveId, f);

      const seen = new Set<string>();
      for (const w of slice.walked) {
        const item = w.item;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        let f = existing.get(item.id) ?? null;
        if (!f && !community) f = await this.adoptFromOtherSource(s, item.id, source);
        if (!f) {
          f = newDriveFile(sourceId, item.id);
          applyMetadata(f, w, ownerEmail, community);
          s.persistFile(f);
          existing.set(item.id, f);
        } else {
          applyMetadata(f, w, ownerEmail, community);
        }
        if (isRemovedFromDrive(f)) {
          f.removedAt = null;
          f.purgeAfter = null;
        }
        f.seenGeneration = generation;
      }

      walk.frontier = [...slice.frontier];
      if (slice.incomplete) markIncomplete(walk, slice.warning);
      const otherSources = new Set<string>();
      if (walkDone(slice)) {
        walk.completedAt = now;
        if (!walk.incomplete) {
          for (const f of [...existing.values()]) {
            if (!removable(f, generation)) continue;
            const target = community ? null : await this.moveToOtherSource(s, f, source);
            if (target != null) {
              otherSources.add(target);
              continue;
            }
            f.removedAt = now;
            f.purgeAfter = now + PURGE_DELAY_US;
          }
        }
      }
      s.saveWalk(walk);
      await this.recalculator.recompute(s, source, await filesOfSource(s, sourceId));
      if (otherSources.size) {
        for (const other of await s.querySources(sql`s.id IN ${uuids([...otherSources])}`)) {
          await this.recalculator.recompute(s, other, await filesOfSource(s, other.id));
        }
      }
      return true;
    });
  }

  /** A row of this item another source of the same student marked removed: moved into this source, id kept. */
  private async adoptFromOtherSource(s: Session, driveId: string, source: DriveSource): Promise<DriveFile | null> {
    const candidate = (await this.inOtherSourcesOfUser(s, driveId, source)).find(isRemovedFromDrive) ?? null;
    if (candidate) candidate.sourceId = source.id;
    return candidate;
  }

  private inOtherSourcesOfUser(s: Session, driveId: string, source: DriveSource): Promise<DriveFile[]> {
    return s.queryFiles(sql`f.drive_id = ${driveId} AND f.source_id <> ${source.id}
        AND f.source_id IN (SELECT id FROM wiki.drive_source WHERE user_id = ${source.userId})`, sql`ORDER BY f.created_at ASC`);
  }

  /** The item left this source and another source of the student holds a live row: this older row moves there. */
  private async moveToOtherSource(s: Session, f: DriveFile, source: DriveSource): Promise<string | null> {
    const live = (await this.inOtherSourcesOfUser(s, f.driveId, source)).find((o) => !isRemovedFromDrive(o)) ?? null;
    if (!live) return null;
    const target = live.sourceId;
    f.parentDriveId = live.parentDriveId;
    f.name = live.name;
    f.mimeType = live.mimeType;
    f.kind = live.kind;
    f.ownerEmail = live.ownerEmail;
    f.ownedBySharer = live.ownedBySharer;
    f.driveVersion = live.driveVersion;
    f.md5Checksum = live.md5Checksum;
    f.sizeBytes = live.sizeBytes;
    f.driveModifiedAt = live.driveModifiedAt;
    f.driveCreatedAt = live.driveCreatedAt;
    applyHiddenDefault(f);
    if (f.subjectId == null) f.subjectId = live.subjectId;
    if (!hasContent(f) && hasContent(live)) copyContent(live, f);
    const dropped = refOf(live);
    const droppedId = live.id;
    await forgetFiles(s, this.janitor, [droppedId]);
    s.deleteFile(live);
    await s.flush();
    f.sourceId = target;
    this.janitor.deleteAfterCommit(s, await releasable(s, [dropped], [droppedId]));
    return target;
  }

  /** Rows whose stored content is missing or outdated; files that failed last time at the end. */
  pendingTasks(sourceId: string): Promise<FetchTask[]> {
    return inSession(this.db, async (s) => {
      const source = await s.sourceById(sourceId);
      if (!source) return [];
      const tasks: FetchTask[] = [];
      const failed: FetchTask[] = [];
      for (const r of await s.rows(sql`SELECT id, drive_id, kind, name, mime_type, drive_version, md5_checksum, size_bytes,
            drive_modified_at, content_fingerprint, content_version, content_modified_at, export_blocked, by_reference,
            sync_error IS NOT NULL AS failed
          FROM wiki.drive_file WHERE source_id = ${sourceId} AND removed_at IS NULL AND kind <> 'FOLDER'`)) {
        const row = {
          id: r.id as string, driveId: r.drive_id as string, kind: r.kind as DriveFileKind, name: r.name as string, mimeType: r.mime_type as string,
          version: r.drive_version == null ? null : Number(r.drive_version), md5: (r.md5_checksum as string) ?? null,
          size: r.size_bytes == null ? null : Number(r.size_bytes), modifiedAt: ts(r.drive_modified_at), fingerprint: (r.content_fingerprint as string) ?? null,
          contentVersion: r.content_version == null ? null : Number(r.content_version), contentModifiedAt: ts(r.content_modified_at),
          exportBlocked: !!r.export_blocked, byReference: !!r.by_reference,
        };
        const reference = byReference(source.storageMode, row.size, this.props.referenceAboveBytes);
        if (!needsFetch(row, reference)) continue;
        const task: FetchTask = {
          fileId: row.id, driveId: row.driveId, kind: row.kind, name: row.name, mimeType: row.mimeType, version: row.version,
          knownFingerprint: row.md5 == null ? null : `md5:${row.md5}`, size: row.size, modifiedAt: row.modifiedAt, reference,
        };
        if (r.failed) failed.push(task);
        else tasks.push(task);
      }
      return [...tasks, ...failed];
    }, { readOnly: true });
  }

  /** Whether a stored copy with this fingerprint exists: this row's own, or another row's. */
  hasCopy(fileId: string, driveId: string, fingerprint: string): Promise<boolean> {
    return inSession(this.db, async (s) => {
      const own = (await s.fileById(fileId))?.contentFingerprint ?? null;
      return fingerprint === own || (await this.contentHolders(s, driveId, fingerprint, fileId)).length > 0;
    }, { readOnly: true });
  }

  private contentHolders(s: Session, driveId: string, fingerprint: string, excludedId: string): Promise<DriveFile[]> {
    return s.queryFiles(sql`f.drive_id = ${driveId} AND f.content_fingerprint = ${fingerprint} AND f.id <> ${excludedId}
      AND f.sync_error IS NULL`, sql`ORDER BY f.updated_at DESC`);
  }

  /** Shares another row's stored copy of the same content; false when no row holds it. */
  private async reuseContent(s: Session, f: DriveFile, fingerprint: string): Promise<boolean> {
    const holder = (await this.contentHolders(s, f.driveId, fingerprint, f.id))[0];
    if (!holder) return false;
    const old = refOf(f);
    copyContent(holder, f);
    if (old.fingerprint !== fingerprint) this.janitor.deleteAfterCommit(s, await releasable(s, [old], []));
    return true;
  }

  /** Saves a checked copy; false when the row or its source is gone (uploaded objects are released). */
  storeContent(sourceId: string, fileId: string, driveId: string, c: Content, modifiedAt: Micros | null): Promise<boolean> {
    return inSession(this.db, async (s) => {
      const source = await s.sourceById(sourceId, true);
      let f: DriveFile | null = null;
      if (source && writable(source)) {
        const row = await s.fileById(fileId);
        f = row && row.sourceId === sourceId ? row : null;
      }
      if (!f) {
        if (!c.existing) {
          this.janitor.deleteAfterCommit(s, await releasable(s, [{ driveId, fingerprint: c.fingerprint, keys: keysOf(c) } as BlobRef], [fileId]));
        }
        return false;
      }
      f.syncError = null;
      if (c.existing) {
        if (f.contentFingerprint === c.fingerprint || (await this.reuseContent(s, f, c.fingerprint))) {
          f.contentVersion = c.version;
          f.contentModifiedAt = modifiedAt;
        } else {
          f.contentModifiedAt = null;
        }
        return true;
      }
      const old = refOf(f);
      setContent(f, c);
      f.byReference = c.byReference;
      f.exportBlocked = c.exportBlocked;
      f.contentModifiedAt = modifiedAt;
      if (old.fingerprint !== c.fingerprint) this.janitor.deleteAfterCommit(s, await releasable(s, [old], []));
      return true;
    });
  }

  storeError(fileId: string, error: string): Promise<void> {
    return inSession(this.db, async (s) => {
      const f = await s.fileById(fileId);
      if (f) f.syncError = truncate(error);
    });
  }

  /** A slice finished: clears the failure streak; ERROR/REVOKED back to ACTIVE or PENDING_REVIEW; a walk warning kept as last_error. */
  finishSync(sourceId: string): Promise<void> {
    return inSession(this.db, async (s) => {
      const warning = (await s.walk(sourceId))?.warning ?? null;
      const src = await s.sourceById(sourceId);
      if (!src) return;
      src.lastSyncedAt = this.now();
      src.lastError = truncate(warning);
      src.consecutiveFailures = 0;
      if (src.status === 'ERROR' || src.status === 'REVOKED') {
        src.status = src.approvedAt != null ? 'ACTIVE' : 'PENDING_REVIEW';
        await this.recalculator.recompute(s, src, await filesOfSource(s, sourceId));
      }
    });
  }

  /** Files removed from Drive more than 30 days ago: rows now, unshared objects after commit. */
  purgeExpired(): Promise<void> {
    return inSession(this.db, async (s) => {
      const expired = await s.queryFiles(sql`f.purge_after < ${toPgTimestamp(this.now())}::timestamptz`);
      if (!expired.length) return;
      const refs = expired.map(refOf);
      const ids = expired.map((f) => f.id);
      await forgetFiles(s, this.janitor, ids);
      for (const f of expired) s.deleteFile(f);
      this.janitor.deleteAfterCommit(s, await releasable(s, refs, ids));
    });
  }

  // ---- Community archives -----------------------------------------------------

  activeCommunityRoots(): Promise<{ id: string; rootFolderId: string }[]> {
    return inSession(this.db, async (s) => (await s.querySources(sql`s.kind = 'COMMUNITY_ROOT' AND s.status = 'ACTIVE'`))
      .map((r) => ({ id: r.id, rootFolderId: r.rootFolderId })), { readOnly: true });
  }

  /** Makes the archive's COMMUNITY sources match `folders`; returns [created, disconnected]. */
  applyCommunityFolders(rootId: string, ownerEmail: string | null, folders: { folderId: string; name: string; subjectId: string }[]): Promise<[number, number]> {
    return inSession(this.db, async (s) => {
      const root = await s.sourceById(rootId, true);
      if (!root || root.kind !== 'COMMUNITY_ROOT' || root.status !== 'ACTIVE') return [0, 0] as [number, number];
      if (ownerEmail != null && ownerEmail.toLowerCase() !== String(root.ownerEmail).toLowerCase()) root.ownerEmail = ownerEmail;
      const now = this.now();
      const children = new Map<string, DriveSource>();
      for (const c of await s.querySources(sql`s.parent_source_id = ${rootId}`)) children.set(c.rootFolderId, c);
      let created = 0;
      let disconnected = 0;
      const listed = new Set<string>();
      for (const folder of folders) {
        listed.add(folder.folderId);
        const child = children.get(folder.folderId);
        if (!child) {
          s.persistSource(communitySource(root, folder.folderId, folder.name, folder.subjectId, now));
          created++;
          continue;
        }
        if (child.status === 'BLOCKED') continue;
        child.rootName = folder.name;
        child.ownerEmail = root.ownerEmail;
        child.displayName = root.displayName;
        if (child.status === 'DISCONNECTED') {
          child.status = 'ACTIVE';
          child.consecutiveFailures = 0;
          child.lastError = null;
          if (child.approvedAt == null) child.approvedAt = now;
        }
        if (child.subjectId !== folder.subjectId) {
          child.subjectId = folder.subjectId;
          await this.recalculator.recompute(s, child, await filesOfSource(s, child.id));
        }
      }
      for (const child of children.values()) {
        if (listed.has(child.rootFolderId)) continue;
        if (child.status === 'DISCONNECTED' || child.status === 'BLOCKED') continue;
        child.status = 'DISCONNECTED';
        await this.dropAllFiles(s, child.id);
        disconnected++;
      }
      return [created, disconnected] as [number, number];
    });
  }

  private async dropAllFiles(s: Session, sourceId: string): Promise<void> {
    const all = await filesOfSource(s, sourceId);
    const refs = all.map(refOf);
    const ids = all.map((f) => f.id);
    await forgetFiles(s, this.janitor, ids);
    for (const f of all) s.deleteFile(f);
    const w = await s.walk(sourceId);
    if (w) s.deleteWalk(w);
    this.janitor.deleteAfterCommit(s, await releasable(s, refs, ids));
  }

  /** Folders shared with the bot that no live source registers. */
  recordUnclaimed(sharedFolders: DriveItem[]): Promise<void> {
    return inSession(this.db, async (s) => {
      const registered = new Set((await s.rows(sql`SELECT root_folder_id FROM wiki.drive_source WHERE status <> 'DISCONNECTED'`)).map((r) => r.root_folder_id as string));
      const now = toPgTimestamp(this.now());
      for (const folder of sharedFolders) {
        if (registered.has(folder.id)) continue;
        const name = folder.name ?? folder.id;
        const owner = firstOwner(folder);
        const [u] = await s.rows(sql`SELECT drive_id FROM wiki.drive_unclaimed_share WHERE drive_id = ${folder.id}`);
        if (u) await s.rows(sql`UPDATE wiki.drive_unclaimed_share SET name = ${name}, owner_email = ${owner}, last_seen_at = ${now}::timestamptz WHERE drive_id = ${folder.id}`);
        else await s.rows(sql`INSERT INTO wiki.drive_unclaimed_share (drive_id, name, owner_email, first_seen_at, last_seen_at) VALUES (${folder.id}, ${name}, ${owner}, ${now}::timestamptz, ${now}::timestamptz)`);
      }
      if (registered.size) {
        await s.rows(sql`DELETE FROM wiki.drive_unclaimed_share WHERE drive_id IN (${sql.join([...registered].map((r) => sql`${r}`), sql`, `)})`);
      }
    });
  }
}

/** Community files all count as the community's; their Drive owner is never stored. */
function applyMetadata(f: DriveFile, w: WalkedItem, ownerEmail: string | null, community: boolean): void {
  const item = w.item;
  f.parentDriveId = w.parentDriveId;
  f.name = item.name;
  f.mimeType = item.mimeType;
  f.kind = w.kind;
  f.ownerEmail = community ? null : firstOwner(item);
  f.ownedBySharer = community || ownedBy(item, ownerEmail);
  f.driveVersion = item.version;
  f.md5Checksum = item.md5Checksum;
  f.sizeBytes = item.size;
  f.driveModifiedAt = item.modifiedTime;
  f.driveCreatedAt = item.createdTime;
  applyHiddenDefault(f);
}

/** The stored HTML points its images at /files/<row id>/assets/: rewritten for the receiving row. */
export function copyContent(from: DriveFile, to: DriveFile): void {
  const html = from.htmlContent == null ? null
    : from.htmlContent.replaceAll(`/api/v1/wiki/files/${from.id}/assets/`, `/api/v1/wiki/files/${to.id}/assets/`);
  setContent(to, {
    version: from.contentVersion, fingerprint: from.contentFingerprint, html, pdfKey: from.pdfKey, originalKey: from.originalKey,
    originalContentType: from.originalContentType, assetPrefix: from.assetPrefix, assetNames: from.assetNames, text: from.textContent,
    metadataOnly: from.metadataOnly,
  });
  to.byReference = from.byReference;
  to.contentModifiedAt = from.contentModifiedAt;
  to.exportBlocked = from.exportBlocked;
}

export { REF };

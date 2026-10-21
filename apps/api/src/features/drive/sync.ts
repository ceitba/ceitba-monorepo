// service/drive/DriveSyncService + DriveCommunityService + DriveSyncTrigger.
// A run: unclaimed shares, community expansion, then every syncable source
// (oldest sync first) within the run budget, then the 30-day purge. A source
// gets a slice of min(remaining budget, DRIVE_SYNC_SOURCE_BUDGET), at most half
// of it walking. No transaction is held across Drive or storage I/O; a source
// is synced by one task at a time (`inProgress`, shared by the job and the
// requested syncs). Requested syncs (register, POST .../sync, reprocess) run
// after commit on their own bounded queue: 2 at a time, 500 waiting, dropped
// (left to the scheduled run) when full.

import { DriveApiError, firstOwner, isFolder, type DriveClient, type DriveItem } from '../../external/drive';
import type { Clock } from '../../infra/clock';
import type { Logger } from '../../infra/logger';
import { msToMicros, type Micros } from '../../lib/time';
import { javaSimpleName } from './errors';
import { communitySubjectFor } from './logic/driveCommunity';
import { JavaLikeError, type DriveContentProcessor } from './processor';
import type { DriveSyncProps } from './props';
import { inSession } from './session';
import type { DriveSyncStore, Snapshot } from './store';
import { DriveWalker, walkDone } from './walker';
import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client';

export type Outcome = 'SYNCED' | 'PARTIAL' | 'REVOKED' | 'FAILED' | 'RATE_LIMITED' | 'SKIPPED';

/** "<SimpleName>: <message>" of an unexpected per-file error, like Java's sync_error. */
function describe(e: unknown): string {
  if (e instanceof JavaLikeError) return `${e.javaClass}: ${e.message}`;
  return `${javaSimpleName(e)}: ${(e as Error)?.message ?? String(e)}`;
}

export class DriveCommunityService {
  constructor(private readonly drive: DriveClient, private readonly store: DriveSyncStore, private readonly db: Database,
              private readonly props: DriveSyncProps, private readonly log: Logger) {}

  async expandAll(): Promise<void> {
    if (!this.props.communityEnabled || !this.drive.available()) return;
    const roots = await this.store.activeCommunityRoots();
    if (!roots.length) return;
    const known = new Set(await inSession(this.db, async (s) => (await s.rows(sql`SELECT id FROM public.subject`)).map((r) => r.id as string), { readOnly: true }));
    const onlyCodes = new Set(this.props.communityOnlyCodes);
    for (const root of roots) await this.expand(root, known, onlyCodes);
  }

  private async expand(root: { id: string; rootFolderId: string }, known: Set<string>, onlyCodes: Set<string>): Promise<void> {
    let ownerEmail: string | null;
    let children: DriveItem[];
    try {
      ownerEmail = firstOwner(await this.drive.getFile(root.rootFolderId));
      children = await this.drive.listChildren(root.rootFolderId);
    } catch (e) {
      if (!(e instanceof DriveApiError)) throw e;
      if (e.isRateLimited()) throw e;
      this.log.warn({ root: root.id, status: e.status, reason: e.reason }, 'Drive sync: community root not listable');
      return;
    }
    const folders: { folderId: string; name: string; subjectId: string }[] = [];
    for (const child of children) {
      if (!isFolder(child)) continue;
      const subject = communitySubjectFor(child.name, known, onlyCodes);
      if (subject != null) folders.push({ folderId: child.id, name: child.name, subjectId: subject });
    }
    const [created, disconnected] = await this.store.applyCommunityFolders(root.id, ownerEmail, folders);
    this.log.info({ root: root.id, folders: folders.length, created, disconnected }, 'Drive sync: community root expanded');
  }
}

export class DriveSyncService {
  private readonly inProgress = new Set<string>();

  constructor(private readonly drive: DriveClient, private readonly store: DriveSyncStore, private readonly processor: DriveContentProcessor,
              private readonly community: DriveCommunityService, private readonly props: DriveSyncProps, private readonly clock: Clock,
              private readonly log: Logger) {}

  /** One scheduled run. */
  async runAll(): Promise<void> {
    if (!this.drive.available()) return;
    const deadline = this.clock.now() + msToMicros(this.props.runBudgetMs);
    let synced = 0;
    try {
      try {
        await this.store.recordUnclaimed(await this.drive.listSharedFolders());
      } catch (e) {
        if (e instanceof DriveApiError) {
          this.log.warn({ status: e.status, err: e.message }, 'Drive sync: listing shared folders failed');
          if (e.isRateLimited()) return;
        } else {
          this.log.warn({ err: (e as Error).message }, 'Drive sync: recording unclaimed shares failed');
        }
      }
      try {
        await this.community.expandAll();
      } catch (e) {
        if (e instanceof DriveApiError) {
          this.log.warn({ status: e.status, err: e.message }, 'Drive sync: community expansion failed');
          if (e.isRateLimited()) return;
        } else {
          this.log.warn({ err: (e as Error).message }, 'Drive sync: community expansion failed');
        }
      }
      for (const id of await this.store.idsToSync()) {
        if (this.clock.now() > deadline) {
          this.log.info({ synced }, 'Drive sync: run budget exhausted');
          break;
        }
        let outcome: Outcome;
        try {
          outcome = await this.syncSourceUntil(id, deadline, false);
        } catch (e) {
          this.log.error({ source: id, err: (e as Error).message }, 'Drive sync: source failed unexpectedly');
          await this.store.recordFailure(id, `Unexpected error: ${javaSimpleName(e)}`).catch(() => {});
          outcome = 'FAILED';
        }
        if (outcome === 'RATE_LIMITED') {
          this.log.warn({ synced }, 'Drive sync: rate limited, stopping this run');
          break;
        }
        synced++;
      }
    } finally {
      await this.store.purgeExpired();
    }
    this.log.info({ synced }, 'Drive sync run done');
  }

  /** A requested sync (also retries a REVOKED source). */
  syncSource(sourceId: string): Promise<Outcome> {
    return this.syncSourceUntil(sourceId, this.clock.now() + msToMicros(this.props.runBudgetMs), true);
  }

  async syncSourceUntil(sourceId: string, deadline: Micros, allowRevoked: boolean): Promise<Outcome> {
    if (!this.drive.available()) return 'SKIPPED';
    if (this.inProgress.has(sourceId)) return 'SKIPPED';
    this.inProgress.add(sourceId);
    try {
      const snapshot = await this.store.snapshot(sourceId, allowRevoked);
      if (!snapshot) return 'SKIPPED';
      return await this.doSync(snapshot, deadline);
    } finally {
      this.inProgress.delete(sourceId);
    }
  }

  private async doSync(source: Snapshot, deadline: Micros): Promise<Outcome> {
    let root: DriveItem;
    try {
      root = await this.drive.getFile(source.rootFolderId);
    } catch (e) {
      if (!(e instanceof DriveApiError)) throw e;
      if (e.isNotFoundOrForbidden()) {
        await this.store.markRevoked(source.id, 'The bot can no longer access the shared folder');
        return 'REVOKED';
      }
      return this.fail(source, e);
    }
    if (!isFolder(root)) {
      await this.store.markRevoked(source.id, 'The shared item is no longer a folder');
      return 'REVOKED';
    }
    const now = this.clock.now();
    const sliceEnd = Math.min(deadline, now + msToMicros(this.props.sourceBudgetMs));
    const walkEnd = now + Math.floor((sliceEnd - now) / 2);

    const walker = new DriveWalker(this.drive, () => this.clock.now(), this.props.maxItemsPerSource, this.props.maxDepth);
    let result;
    let generation: number;
    try {
      let state = await this.store.resumeWalk(source.id);
      if (!state) state = await this.store.startWalk(source.id, root.id, await walker.rootAncestors(root));
      generation = state.generation;
      result = await walker.walk({ rootId: root.id, ownerEmail: source.ownerEmail, community: source.community,
        communityRootId: source.communityRootFolderId, rootAncestors: new Set(state.rootAncestors) }, state.frontier, state.seen, walkEnd);
    } catch (e) {
      if (!(e instanceof DriveApiError)) throw e;
      return this.fail(source, e);
    }

    // Disconnected, blocked or deleted while we walked: nothing applied.
    if (!(await this.store.applyWalk(source.id, root.name, result, generation))) return 'SKIPPED';

    const tasks = await this.store.pendingTasks(source.id);
    let allFetched = true;
    for (const task of tasks) {
      if (this.clock.now() > sliceEnd) {
        allFetched = false;
        break;
      }
      try {
        const c = await this.processor.process({ fileId: task.fileId, driveId: task.driveId, kind: task.kind, name: task.name,
          mimeType: task.mimeType, version: task.version, knownFingerprint: task.knownFingerprint, size: task.size, reference: task.reference,
          previous: () => this.store.previousContent(task.fileId) },
        (fp) => this.store.hasCopy(task.fileId, task.driveId, fp));
        if (!(await this.store.storeContent(source.id, task.fileId, task.driveId, c, task.modifiedAt))) {
          if (!(await this.store.isSyncable(source.id))) return 'SKIPPED';
        }
      } catch (e) {
        if (e instanceof DriveApiError) {
          await this.store.storeError(task.fileId, `Drive ${e.status} ${e.reason}: ${e.message}`);
          if (e.isRateLimited()) {
            await this.store.recordFailure(source.id, 'Rate limited by Google Drive');
            return 'RATE_LIMITED';
          }
        } else {
          this.log.warn({ file: task.driveId, source: source.id, err: (e as Error).message }, 'Drive sync: file failed');
          await this.store.storeError(task.fileId, describe(e));
        }
      }
    }
    await this.store.finishSync(source.id);
    return walkDone(result) && allFetched ? 'SYNCED' : 'PARTIAL';
  }

  private async fail(source: Snapshot, e: DriveApiError): Promise<Outcome> {
    this.log.warn({ source: source.id, status: e.status, reason: e.reason, err: e.message }, 'Drive sync: source failed');
    await this.store.recordFailure(source.id, `Google Drive error ${e.status}${e.reason == null ? '' : ` ${e.reason}`}`);
    return e.isRateLimited() ? 'RATE_LIMITED' : 'FAILED';
  }
}

/** DriveSyncTrigger: requested syncs after commit, 2 at a time, at most 500 waiting. */
export class DriveSyncTrigger {
  static readonly THREADS = 2;
  static readonly QUEUE_CAPACITY = 500;
  private readonly queue: string[] = [];
  private running = 0;
  private readonly idleWaiters: (() => void)[] = [];

  constructor(private readonly sync: () => DriveSyncService, private readonly log: Logger) {}

  request(sourceId: string): void {
    if (this.queue.length >= DriveSyncTrigger.QUEUE_CAPACITY) {
      this.log.warn({ source: sourceId }, 'Drive sync queue full; requested sync left to the scheduled run');
      return;
    }
    this.queue.push(sourceId);
    this.pump();
  }

  private pump(): void {
    while (this.running < DriveSyncTrigger.THREADS && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      void this.sync().syncSource(id)
        .catch((e) => this.log.error({ source: id, err: (e as Error).message }, 'Requested Drive sync failed'))
        .finally(() => {
          this.running--;
          this.pump();
          if (this.running === 0 && this.queue.length === 0) for (const w of this.idleWaiters.splice(0)) w();
        });
    }
  }

  /** Resolves once no requested sync is queued or running (tests). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }
}

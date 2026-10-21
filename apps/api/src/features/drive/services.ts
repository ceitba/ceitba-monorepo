// One set of drive services per Deps (Spring's singletons): routes, the
// requested-sync queue, the scheduled job and tests share the same
// DriveSyncService (its in-progress set) and DriveSyncTrigger.
// Constructors do no I/O (routes are registered without a database).

import type { Deps } from '../../deps';
import { DriveJanitor } from './blobs';
import { kbTakedown } from './kbHooks';
import { ContentPool } from './logic/contentPool';
import { DriveModerationService } from './moderationService';
import { DriveContentProcessor } from './processor';
import { driveProps, type DriveSyncProps } from './props';
import { DriveReaderService } from './readerService';
import { DriveRecalculator } from './recalculator';
import { DriveSourceService } from './sourceService';
import { DriveSyncStore } from './store';
import { DriveCommunityService, DriveSyncService, DriveSyncTrigger } from './sync';

export interface DriveServices {
  props: DriveSyncProps;
  pool: ContentPool;
  janitor: DriveJanitor;
  recalculator: DriveRecalculator;
  store: DriveSyncStore;
  processor: DriveContentProcessor;
  community: DriveCommunityService;
  sync: DriveSyncService;
  trigger: DriveSyncTrigger;
  sources: DriveSourceService;
  reader: DriveReaderService;
  moderation: DriveModerationService;
}

const cache = new WeakMap<object, DriveServices>();

/** Content workers: DRIVE_CONTENT_WORKERS (default 2; 0 = inline). */
const workers = () => {
  const n = Number(process.env.DRIVE_CONTENT_WORKERS ?? 2);
  return Number.isFinite(n) && n >= 0 ? n : 2;
};

export function driveServices(deps: Deps): DriveServices {
  const hit = cache.get(deps);
  if (hit) return hit;
  const log = deps.log.child({ component: 'drive' });
  const props = driveProps(deps.config);
  const pool = new ContentPool(workers());
  const janitor = new DriveJanitor(deps.storage, log);
  const recalculator = new DriveRecalculator(deps.clock, kbTakedown(deps));
  const store = new DriveSyncStore(deps, props, recalculator, janitor);
  const processor = new DriveContentProcessor(deps.drive, deps.storage, props, pool, log);
  const community = new DriveCommunityService(deps.drive, store, deps.db, props, log);
  const sync = new DriveSyncService(deps.drive, store, processor, community, props, deps.clock, log);
  const trigger = new DriveSyncTrigger(() => sync, log);
  const ctx = { trigger };
  const svc: DriveServices = {
    props, pool, janitor, recalculator, store, processor, community, sync, trigger,
    sources: new DriveSourceService(deps, recalculator, janitor, ctx),
    reader: new DriveReaderService(deps, props, recalculator),
    moderation: new DriveModerationService(deps, recalculator, janitor, ctx),
  };
  cache.set(deps, svc);
  return svc;
}

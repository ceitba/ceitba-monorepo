// scheduling/DriveSyncJob: periodic Drive sync, off unless DRIVE_SYNC_ENABLED.
// Fixed delay (DRIVE_SYNC_INTERVAL) after an initial PT1M; each run stops at
// DRIVE_SYNC_RUN_BUDGET; JobLock DRIVE_SYNC (id 9) keeps runs from overlapping
// across processes. A failed run is logged, never thrown.
import { defineJobs } from '../../jobs/scheduler';
import { driveServices } from './services';

export default defineJobs((deps) => {
  const props = driveServices(deps).props;
  return [{
    name: 'DriveSyncJob#run',
    lock: 'DRIVE_SYNC',
    schedule: { fixedDelayMs: props.intervalMs, initialDelayMs: 60_000 },
    enabled: props.enabled,
    run: async () => {
      try {
        await driveServices(deps).sync.runAll();
      } catch (e) {
        deps.log.error({ err: (e as Error).message }, 'Scheduled Drive sync failed');
      }
    },
  }];
});

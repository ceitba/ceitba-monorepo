// scheduling/DataSyncJob: twice a day (00:00 and 12:00 in the server zone),
// only with sync.enabled=true (SYNC_ENABLED), under JobLock DATA_SYNC.

import { defineJobs } from '../../jobs/scheduler';
import { DataSyncService } from './dataSync';

export default defineJobs((deps) => {
  const svc = new DataSyncService(deps);
  const log = deps.log.child({ component: 'DataSyncJob' });
  return [{
    name: 'DataSyncJob#run',
    lock: 'DATA_SYNC',
    schedule: { cron: '0 0 0,12 * * *' },
    enabled: deps.config.integrations.sync.enabled,
    async run() {
      try {
        const r = await svc.syncAll(null);
        log.info({
          subjects: [r.subjects.created, r.subjects.updated, r.subjects.errors],
          plans: [r.subjectPlans.created, r.subjectPlans.updated, r.subjectPlans.errors],
          commissions: [r.commissions.created, r.commissions.updated, r.commissions.errors],
        }, 'Scheduled sync done');
      } catch (e) {
        log.error({ err: e }, 'Scheduled sync failed');
      }
    },
  }];
});

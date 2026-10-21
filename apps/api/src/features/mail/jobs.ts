// scheduling/MailRetentionJob: nightly 03:40 ART (JobLock 3, MAIL_RETENTION);
// off with DIGEST_JOBS_ENABLED=false like the Java bean.
import { defineJobs } from '../../jobs/scheduler';
import { ART } from '../../lib/time';
import { mailBeans } from './service';
import { mailSettings } from './settings';

export default defineJobs((deps) => [{
  name: 'MailRetentionJob#run', lock: 'MAIL_RETENTION', enabled: mailSettings(deps.config).digest.jobsEnabled,
  schedule: { cron: '0 40 3 * * *', zone: ART },
  run: async () => {
    try {
      await mailBeans(deps).retention.cleanup();
    } catch (e) {
      deps.log.child({ component: 'MailRetentionJob' }).warn(`Mail retention cleanup failed: ${(e as Error).message}`);
    }
  },
}]);

// scheduling/OrgMailJob: every org-mail.tick-interval (PT2M, initial 1 min) and
// at startup (ApplicationReadyEvent hook), hand the worker to the "task executor". No JobLock (JobLock id 8
// is retired): the delivery claims (FOR UPDATE SKIP LOCKED) keep two processes
// from sending the same email. Off with ORG_MAIL_JOBS_ENABLED=false.
import { defineJobs } from '../../jobs/scheduler';
import { mailSettings } from '../mail/settings';
import { orgMailBeans } from './beans';

export default defineJobs((deps) => {
  const s = mailSettings(deps.config).orgMail;
  return {
    jobs: [
      { name: 'OrgMailJob#tick', enabled: s.jobsEnabled, schedule: { fixedDelayMs: s.tickIntervalMs, initialDelayMs: 60_000 },
        run: async () => { orgMailBeans(deps).kick(); } },
    ],
    startup: [{ name: 'OrgMailJob#onStartup', order: 40, enabled: s.jobsEnabled, run: async () => { orgMailBeans(deps).kick(); } }],
    shutdown: [
      { name: 'OrgAnnouncementSender#onShutdown', phase: 'closing', order: 20, run: () => orgMailBeans(deps).sender.onShutdown() },
      { name: 'OrgAnnouncementSender (task executor)', phase: 'executors', order: 20, run: () => orgMailBeans(deps).idle() },
    ],
  };
});

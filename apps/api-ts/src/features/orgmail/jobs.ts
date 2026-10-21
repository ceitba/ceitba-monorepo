// scheduling/OrgMailJob: every org-mail.tick-interval (PT2M, initial 1 min) and
// at startup, hand the worker to the "task executor". No JobLock (JobLock id 8
// is retired): the delivery claims (FOR UPDATE SKIP LOCKED) keep two processes
// from sending the same email. Off with ORG_MAIL_JOBS_ENABLED=false.
import { defineJobs } from '../../jobs/scheduler';
import { mailSettings } from '../mail/settings';
import { orgMailBeans } from './beans';

export default defineJobs((deps) => {
  const s = mailSettings(deps.config).orgMail;
  let started = false;
  return [
    { name: 'OrgMailJob#tick', enabled: s.jobsEnabled, schedule: { fixedDelayMs: s.tickIntervalMs, initialDelayMs: 60_000 },
      run: async () => { orgMailBeans(deps).kick(); } },
    { name: 'OrgMailJob#onStartup', enabled: s.jobsEnabled, schedule: { fixedDelayMs: 24 * 3_600_000, initialDelayMs: 0 },
      run: async () => { if (!started) { started = true; orgMailBeans(deps).kick(); } } },
  ];
});

// The orgmail singletons of one app instance, shared by routes.ts and jobs.ts.
import type { Deps } from '../../deps';
import { mailSettings } from '../mail/settings';
import { OrgAnnouncementSender } from './sender';
import { OrgAnnouncementService } from './service';

export interface OrgMailBeans {
  service: OrgAnnouncementService;
  sender: OrgAnnouncementSender;
  /** OrgMailJob.kick (only when org-mail.jobs-enabled, like the Java bean). */
  kick(): void;
  idle(): Promise<void>;
}

const byDeps = new WeakMap<Deps, OrgMailBeans>();

export function orgMailBeans(deps: Deps): OrgMailBeans {
  const hit = byDeps.get(deps);
  if (hit) return hit;
  const settings = mailSettings(deps.config);
  const inFlight = new Set<Promise<void>>();
  let sender: OrgAnnouncementSender;
  const kick = () => {
    if (!settings.orgMail.jobsEnabled) return;
    const run = (async () => {
      await Promise.resolve();
      await sender.runPending();
    })();
    inFlight.add(run);
    void run.finally(() => inFlight.delete(run));
  };
  const service = new OrgAnnouncementService(deps, kick);
  sender = new OrgAnnouncementSender(deps, settings, service, deps.log.child({ component: 'orgmail' }));
  const beans: OrgMailBeans = {
    service, sender, kick,
    async idle() { while (inFlight.size > 0) await Promise.allSettled([...inFlight]); },
  };
  byDeps.set(deps, beans);
  return beans;
}

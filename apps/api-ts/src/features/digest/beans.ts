// The digest singletons of one app instance (Spring beans): shared by
// routes.ts, jobs.ts and the mail tracking routes, so the worker's `running`
// flag, the tracking rate-limit buckets and the MailSendService lock are one.

import type { Deps } from '../../deps';
import { contentHmac } from '../crypto/service';
import { mailBeans } from '../mail/service';
import { DigestComposer } from './composer';
import { DigestCorrectionVoteService } from './correctionVote';
import { DigestCorrectionVoteTokens } from './logic/digestCorrectionVoteTokens';
import { DigestUnsubscribeTokens } from './logic/digestUnsubscribeTokens';
import { TuCuatrimestreSection } from './personal';
import { DigestSender } from './sender';
import { DigestService } from './service';
import { DigestTrackingService } from './tracking';

export interface DigestBeans {
  service: DigestService;
  sender: DigestSender;
  tracking: DigestTrackingService;
  composer: DigestComposer;
  votes: DigestCorrectionVoteService;
  unsubscribeTokens: DigestUnsubscribeTokens;
  /** DigestJob.kick: the worker on the "task executor" (never awaited by the caller). */
  kick(): void;
  /** Resolves when the kicked workers are idle (tests, shutdown). */
  idle(): Promise<void>;
}

const byDeps = new WeakMap<Deps, DigestBeans>();

export function digestBeans(deps: Deps): DigestBeans {
  const hit = byDeps.get(deps);
  if (hit) return hit;
  const mail = mailBeans(deps);
  const settings = mail.settings;
  const log = deps.log.child({ component: 'digest' });
  const hmac = contentHmac(deps.config);
  const unsubscribeTokens = new DigestUnsubscribeTokens(hmac);
  const voteTokens = new DigestCorrectionVoteTokens(hmac, deps.clock, settings.personal.voteTokenTtlMs);
  const personal = new TuCuatrimestreSection(deps, settings, voteTokens);
  const composer = new DigestComposer(deps, settings, unsubscribeTokens, personal, log);
  const tracking = new DigestTrackingService(deps, settings, hmac);
  const sender = new DigestSender(deps, settings, composer, mail.sender, tracking, log);
  const inFlight = new Set<Promise<void>>();
  const kick = () => {
    // DigestJob is a bean only with digest.jobs-enabled (tests: off).
    if (!settings.digest.jobsEnabled) return;
    const run = (async () => {
      await Promise.resolve();
      await sender.runPending();
    })();
    inFlight.add(run);
    void run.finally(() => inFlight.delete(run));
  };
  const service = new DigestService(deps, settings, composer, unsubscribeTokens, mail.sender, tracking, log, kick);
  const beans: DigestBeans = {
    service, sender, tracking, composer, unsubscribeTokens, kick,
    votes: new DigestCorrectionVoteService(deps, settings, voteTokens),
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
  byDeps.set(deps, beans);
  return beans;
}

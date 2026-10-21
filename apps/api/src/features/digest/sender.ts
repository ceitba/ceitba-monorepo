// service/digest/DigestSender: the sending worker. Walks the pending
// deliveries of every `sending` issue, one email at a time, at most once each:
// claim (its own committed transaction, FOR UPDATE SKIP LOCKED), then send in
// a second transaction holding a share lock on the issue row. See the Java
// class comment and docs/WEEKLY-DIGEST.md "Sending".

import type { Deps } from '../../deps';
import { withTx, type Tx } from '../../db/client';
import { EmailSendError } from '../../infra/mail';
import type { Logger } from '../../infra/logger';
import { withAmbientTx } from '../mail/ambient';
import { MailQuotaExhausted, type MailSendService } from '../mail/logic/mailSendService';
import { newTrackingId } from '../mail/logic/mailLinkRewriter';
import type { MailSettings } from '../mail/settings';
import { issueOf, type ComposerIssue, type DigestComposer } from './composer';
import type { DigestTemplate } from './logic/digestRenderer';
import * as repo from './repo';
import type { DigestTrackingService } from './tracking';

const MAX_ERROR_LENGTH = 1000;
export const MAX_ATTEMPTS = 3;
export const CLAIM_TIMEOUT_MS = 5 * 60_000;
export const RETRY_DELAY_MS = 2 * 60_000;
export const UNKNOWN_OUTCOME = 'unknown outcome (interrupted)';

export type Outcome = 'DONE' | 'STOPPED' | 'CANCELLED';
type Step = 'SENT' | 'FAILED' | 'SKIPPED' | 'RETRY' | 'TRANSPORT' | 'QUOTA' | 'CANCELLED';

export type Sleeper = (ms: number) => Promise<void>;

const truncate = (s: string | null | undefined) => (s == null ? 'unknown error' : s.length <= MAX_ERROR_LENGTH ? s : s.slice(0, MAX_ERROR_LENGTH));
/** Throwable.toString() of a non-EmailSendException failure. */
const javaToString = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export class DigestSender {
  private running = false;
  private stopping = false;
  private lastUnavailable: string | null = null;

  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly composer: DigestComposer,
              private readonly sender: MailSendService, private readonly tracking: DigestTrackingService, private readonly log: Logger,
              public sleeper: Sleeper = (ms) => Bun.sleep(ms)) {}

  /** Graceful shutdown: the email in flight is finished, no new one is started. */
  onShutdown(): void {
    this.stopping = true;
  }

  /** Processes every sending issue; a no-op while another run is active or mail is disabled. */
  async runPending(): Promise<void> {
    if (!this.sender.enabled()) {
      this.log.debug('Digest sending skipped: mail is disabled (MAIL_ENABLED=false)');
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      await this.reclaimStale();
      const ids = await withTx(this.deps.db, (tx) => repo.findSendingIds(tx), { readOnly: true });
      if (ids.length === 0) return;
      if (await this.senderUnavailable()) return;
      const readyAt = await this.sender.readyAt();
      if (readyAt != null) {
        this.log.debug(`Digest sending waits until ${readyAt} (sending quota / pause of ${this.sender.account})`);
        return;
      }
      for (const id of ids) {
        if (this.stopping) break;
        if ((await this.process(id)) === 'STOPPED') break;
      }
    } catch (e) {
      this.log.warn({ err: e }, `Digest sending run failed (the next tick retries): ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async senderUnavailable(): Promise<boolean> {
    const reason = await this.sender.unavailableReason();
    if (reason !== this.lastUnavailable) {
      this.lastUnavailable = reason;
      if (reason != null) this.log.warn(`Digest sending skipped until the sender account is fixed: ${reason}`);
      else this.log.info('Digest sending resumes: the sender account is usable again');
    }
    return reason != null;
  }

  /** Rows left `sending` by a crash: outcome unknown -> failed, not resent. */
  async reclaimStale(): Promise<void> {
    const n = await withTx(this.deps.db, (tx) => repo.failStale(tx, this.deps.clock.now() - CLAIM_TIMEOUT_MS * 1000, UNKNOWN_OUTCOME));
    if (n > 0) this.log.warn(`Digest: ${n} deliveries were interrupted mid-send; marked failed, not resent`);
  }

  async process(issueId: string): Promise<Outcome> {
    const loaded = await withTx(this.deps.db, async (tx) => {
      const row = await repo.findIssue(tx, issueId);
      if (row == null || row.status !== 'sending') return null;
      const issue = issueOf(row);
      return { issue, content: await this.composer.content(tx, issue) };
    }, { readOnly: true });
    if (loaded == null) return 'CANCELLED';
    const { issue } = loaded;
    const template = this.composer.template(issue, loaded.content);
    const shared = this.tracking.enabled()
      ? await withTx(this.deps.db, (tx) => this.tracking.issueLinks(tx, issueId, template))
      : new Map<string, number>();
    for (;;) {
      if (this.stopping) return 'STOPPED';
      const d = await withTx(this.deps.db, (tx) => this.claimNext(tx, issue.id));
      if (d == null) {
        await this.markSentIfDone(issue);
        return 'DONE';
      }
      const step = await withTx(this.deps.db, (tx) => withAmbientTx(tx, () => this.sendClaimed(tx, issue, template, d, shared)));
      switch (step) {
        case 'CANCELLED':
          this.log.info(`Digest ${issue.week.weekStart}: no longer sending, stopped`);
          return 'CANCELLED';
        case 'TRANSPORT':
        case 'QUOTA':
          return 'STOPPED';
        case 'SKIPPED':
          break;
        default:
          await this.sleeper(this.settings.digest.sendIntervalMs);
      }
    }
  }

  private async markSentIfDone(issue: ComposerIssue): Promise<void> {
    if ((await withTx(this.deps.db, (tx) => repo.markIssueSentIfDone(tx, issue.id, this.deps.clock.now()))) > 0) {
      this.log.info(`Digest ${issue.week.weekStart}: all deliveries processed, issue sent`);
    }
  }

  async claimNext(tx: Tx, issueId: string): Promise<repo.DeliveryRow | null> {
    const now = this.deps.clock.now();
    const next = await repo.lockNextPending(tx, issueId, now - RETRY_DELAY_MS * 1000);
    if (next == null) return null;
    if ((await repo.markSending(tx, issueId, next.userId, now)) === 0) return null;
    return next;
  }

  async sendClaimed(tx: Tx, issue: ComposerIssue, template: DigestTemplate, d: repo.DeliveryRow, shared: ReadonlyMap<string, number>): Promise<Step> {
    const issueId = issue.id;
    const userId = d.userId;
    const status = await repo.findStatusForShare(tx, issueId);
    if (status !== 'sending') {
      await repo.deleteClaimed(tx, issueId, userId);
      return 'CANCELLED';
    }
    if (!(await this.composer.stillEligible(tx, userId, d.email))) {
      await repo.deleteClaimed(tx, issueId, userId);
      return 'SKIPPED';
    }
    try {
      let email = await this.composer.email(tx, issue, template, userId, d.email, false);
      if (this.tracking.enabled()) {
        // Kept across retries of the same delivery.
        const trackingId = d.trackingId ?? newTrackingId();
        const tracked = this.tracking.track(email, trackingId, shared);
        await repo.setTrackingId(tx, issueId, userId, trackingId);
        await this.tracking.saveDeliveryLinks(tx, trackingId, tracked.personalLinks);
        email = tracked.email;
      }
      await this.sender.send(email);
    } catch (e) {
      if (e instanceof MailQuotaExhausted) {
        this.log.info(`Digest sending paused: sending quota of ${e.account} used up, resumes at ${e.resumeAt}`);
        await repo.release(tx, issueId, userId, truncate(e.message));
        return 'QUOTA';
      }
      if (e instanceof EmailSendError) {
        switch (e.kind) {
          case 'TRANSPORT':
          case 'QUOTA':
            this.log.warn(`Digest sending paused, transport problem (retried later): ${e.message}`);
            await repo.release(tx, issueId, userId, truncate(e.message));
            return 'TRANSPORT';
          case 'TRANSIENT': {
            const attempts = d.attempts + 1;
            if (attempts >= MAX_ATTEMPTS) return this.fail(tx, issueId, userId, `gave up after ${attempts} attempts: ${truncate(e.message)}`);
            this.log.warn(`Digest delivery to user ${userId}: temporary failure, attempt ${attempts}/${MAX_ATTEMPTS}: ${e.message}`);
            await repo.retryLater(tx, issueId, userId, truncate(e.message));
            return 'RETRY';
          }
          default:
            return this.fail(tx, issueId, userId, truncate(e.message));
        }
      }
      this.log.warn(`Digest delivery to user ${userId} failed: ${(e as Error)?.message}`);
      return this.fail(tx, issueId, userId, truncate(javaToString(e)));
    }
    if ((await repo.markSent(tx, issueId, userId, this.deps.clock.now())) === 0) {
      this.log.error(`Digest delivery to user ${userId} was sent but its row was no longer \`sending\``);
    }
    return 'SENT';
  }

  private async fail(tx: Tx, issueId: string, userId: string, error: string): Promise<Step> {
    if ((await repo.markFailed(tx, issueId, userId, this.deps.clock.now(), error)) === 0) {
      this.log.error(`Digest delivery to user ${userId} failed but its row was no longer \`sending\``);
    }
    return 'FAILED';
  }
}

// service/orgmail/OrgAnnouncementSender: sends organizations' announcements
// one email at a time, at most once each, exactly like DigestSender: claim the
// next pending delivery in its own committed transaction (FOR UPDATE SKIP
// LOCKED), then send and mark it in a second one. Each announcement goes out
// through its org's own account (OrgMailSenders).

import type { Deps } from '../../deps';
import type { Tx } from '../../db/client';
import { EmailSendError } from '../../infra/mail';
import type { Logger } from '../../infra/logger';
import { withAmbientTx } from '../mail/ambient';
import { MailQuotaExhausted, type MailSendService } from '../mail/logic/mailSendService';
import type { MailSettings } from '../mail/settings';
import * as repo from './repo';
import type { OrgAnnouncementService } from './service';

const MAX_ERROR_LENGTH = 1000;
export const MAX_ATTEMPTS = 3;
export const CLAIM_TIMEOUT_MS = 5 * 60_000;
export const RETRY_DELAY_MS = 2 * 60_000;
export const UNKNOWN_OUTCOME = 'unknown outcome (interrupted)';

type Step = 'SENT' | 'FAILED' | 'SKIPPED' | 'RETRY' | 'STOP';
const truncate = (s: string | null | undefined) => (s == null ? 'unknown error' : s.length <= MAX_ERROR_LENGTH ? s : s.slice(0, MAX_ERROR_LENGTH));

export class OrgAnnouncementSender {
  private running = false;
  private stopping = false;

  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly service: OrgAnnouncementService,
              private readonly log: Logger, public sleeper: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms)) {}

  onShutdown(): void {
    this.stopping = true;
  }

  async runPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const stale = await repo.failStale(this.deps.db, this.deps.clock.now() - CLAIM_TIMEOUT_MS * 1000, UNKNOWN_OUTCOME);
      if (stale > 0) this.log.warn(`Org mail: ${stale} deliveries were interrupted mid-send; marked failed`);
      for (const id of await repo.findSendingIds(this.deps.db)) {
        if (this.stopping) break;
        await this.process(id);
      }
    } catch (e) {
      this.log.warn({ err: e }, `Org mail sending run failed (the next tick retries): ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async process(id: number): Promise<void> {
    const a = await repo.findById(this.deps.db, id);
    if (a == null || a.status !== 'sending') return;
    const org = await repo.findOrg(this.deps.db, a.orgSlug);
    const sender = await this.service.senderOf(a);
    if (org == null || sender == null) return;
    if (!sender.enabled()) return;
    const unavailable = await sender.unavailableReason();
    if (unavailable != null) {
      this.log.debug(`Org mail ${id} waits: ${unavailable}`);
      return;
    }
    if ((await sender.readyAt()) != null) return;
    while (!this.stopping) {
      const d = await this.deps.db.transaction((tx) => this.claimNext(tx, id));
      if (d == null) {
        if ((await repo.markSentIfDone(this.deps.db, id, this.deps.clock.now())) > 0) {
          this.log.info(`Org mail ${id} of ${a.orgSlug}: all deliveries processed`);
        }
        return;
      }
      const step = await this.deps.db.transaction((tx) => withAmbientTx(tx, () => this.sendClaimed(tx, org, a, sender, d)));
      if (step === 'STOP') return;
      if (step !== 'SKIPPED') await this.sleeper(this.settings.digest.sendIntervalMs);
    }
  }

  async claimNext(tx: Tx, id: number): Promise<repo.DeliveryRow | null> {
    const now = this.deps.clock.now();
    const next = await repo.lockNextPending(tx, id, now - RETRY_DELAY_MS * 1000);
    if (next == null) return null;
    if ((await repo.markSending(tx, id, next.userId, now)) === 0) return null;
    return next;
  }

  async sendClaimed(tx: Tx, org: repo.OrgRow, a: repo.AnnouncementRow, sender: MailSendService, d: repo.DeliveryRow): Promise<Step> {
    const id = a.id;
    const userId = d.userId;
    if (!(await this.service.stillRecipient(tx, userId, d.email, a.orgSlug))) {
      await repo.deleteClaimed(tx, id, userId);
      return 'SKIPPED';
    }
    try {
      await sender.send(this.service.email(org, a, userId, d.email, false));
    } catch (e) {
      if (e instanceof MailQuotaExhausted) {
        this.log.info(`Org mail ${id} paused: quota of ${e.account} used up, resumes at ${e.resumeAt}`);
        await repo.release(tx, id, userId, truncate(e.message));
        return 'STOP';
      }
      if (e instanceof EmailSendError) {
        switch (e.kind) {
          case 'TRANSPORT':
          case 'QUOTA':
            this.log.warn(`Org mail ${id} paused, transport problem (retried later): ${e.message}`);
            await repo.release(tx, id, userId, truncate(e.message));
            return 'STOP';
          case 'TRANSIENT':
            if (d.attempts + 1 >= MAX_ATTEMPTS) return this.fail(tx, id, userId, `gave up after ${d.attempts + 1} attempts: ${truncate(e.message)}`);
            await repo.retryLater(tx, id, userId, truncate(e.message));
            return 'RETRY';
          default:
            return this.fail(tx, id, userId, truncate(e.message));
        }
      }
      this.log.warn(`Org mail ${id} delivery to user ${userId} failed: ${(e as Error)?.message}`);
      return this.fail(tx, id, userId, truncate(e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    }
    if ((await repo.markSent(tx, id, userId, this.deps.clock.now())) === 0) {
      this.log.error(`Org mail ${id} delivery to user ${userId} was sent but its row was no longer \`sending\``);
    }
    return 'SENT';
  }

  private async fail(tx: Tx, id: number, userId: string, error: string): Promise<Step> {
    if ((await repo.markFailed(tx, id, userId, this.deps.clock.now(), error)) === 0) {
      this.log.error(`Org mail ${id} delivery to user ${userId} failed but its row was no longer \`sending\``);
    }
    return 'FAILED';
  }
}

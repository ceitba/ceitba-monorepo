// Port of apps/api/src/test/java/org/ceitba/api/service/mail/InMemoryMailLedger.java:
// MailLedger for unit tests, same semantics as the database one.
import type { Micros } from '../../../src/lib/time';
import type { MailAccountState, MailLedger, MailOutcome, MailUsage } from '../../../src/features/mail/logic/mailLedger';

export interface Row { account: string; kind: string; recipients: number; outcome: MailOutcome; error: string | null; at: Micros }

const counted = (r: Row) => r.outcome === 'SENT' || r.outcome === 'REJECTED';

export class InMemoryMailLedger implements MailLedger {
  readonly rows: Row[] = [];
  readonly states = new Map<string, MailAccountState>();

  async usedSince(account: string, since: Micros): Promise<number> {
    return this.rows.filter((r) => r.account === account && r.at > since && counted(r)).reduce((n, r) => n + r.recipients, 0);
  }

  async usageSince(account: string, since: Micros): Promise<MailUsage[]> {
    return this.rows.filter((r) => r.account === account && r.at > since && counted(r))
      .sort((a, b) => a.at - b.at)
      .map((r) => ({ at: r.at, recipients: r.recipients }));
  }

  async record(account: string, kind: string, recipients: number, outcome: MailOutcome, error: string | null, at: Micros): Promise<void> {
    this.rows.push({ account, kind, recipients, outcome, error, at });
  }

  async state(account: string): Promise<MailAccountState | null> {
    return this.states.get(account) ?? null;
  }

  async saveState(account: string, state: MailAccountState): Promise<void> {
    this.states.set(account, state);
  }

  /** `n` counted sends at `at` (seeding the window). */
  sent(account: string, at: Micros, n: number): void {
    for (let i = 0; i < n; i++) this.rows.push({ account, kind: 'digest', recipients: 1, outcome: 'SENT', error: null, at });
  }
}

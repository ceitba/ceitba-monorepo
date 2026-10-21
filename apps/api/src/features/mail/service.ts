// service/mail: the database side of the mail feature and its wiring
// (config/MailConfig):
//   DrizzleMailLedger       = JpaMailLedger (REQUIRES_NEW: always on deps.db)
//   MailSenderAccountService (connect flow, credentials, status)
//   MailRetentionService     (nightly cleanup)
//   OrgMailSenders           (one MailSendService per organization account)
//   mailBeans(deps)          the singletons, shared by routes.ts and jobs.ts of
//                            every feature that sends mail (digest, orgmail).
// MailSendService (logic/mailSendService.ts) is THE sender: every transport is
// wrapped in it, so no caller bypasses the sending quota.

import type { Deps } from '../../deps';
import { FeatureNotConfiguredError, ResourceNotFoundError } from '../../http/errors';
import {
  DisabledEmailSender, GmailApiTransportSlot, LoggingEmailSender, UnavailableEmailSender, type EmailSender,
} from '../../infra/mail';
import type { Logger } from '../../infra/logger';
import { javaEqualsIgnoreCase, javaIsBlank, javaStrip, javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, type Micros } from '../../lib/time';
import { withTx, type Db } from '../../db/client';
import { ambientDb } from './ambient';
import { GoogleMailOAuthClient, SCOPE_SEND, type IdClaims } from './googleMailOAuth';
import { GmailApiEmailSender, type MailSenderAccounts } from './logic/gmailApiEmailSender';
import { MailAccessTokenCache } from './logic/mailAccessTokenCache';
import { CLEAR, mailOutcomeDb, type MailAccountState, type MailLedger, type MailOutcome, type MailUsage } from './logic/mailLedger';
import { MailOAuthStateService, type MailOAuthState } from './logic/mailOAuthState';
import { MailSendService } from './logic/mailSendService';
import { MailTokenCipher, TokenDecryptionError } from './logic/mailTokenCipher';
import type { MailCredentials } from './logic/types';
import * as repo from './repo';
import {
  isAllowedRecipient, limitFor, mailSettings, orgMailAllows, TRANSPORT_GMAIL_API, TRANSPORT_LOG, type MailSettings,
} from './settings';

const MAX_ERROR_LENGTH = 1000;

// ------------------------------------------------------------ ledger

export class DrizzleMailLedger implements MailLedger {
  constructor(private readonly deps: Pick<Deps, 'db'>) {}

  usedSince(account: string, since: Micros): Promise<number> {
    return withTx(this.deps.db, (tx) => repo.sumCountedSince(tx, account, since), { readOnly: true });
  }

  usageSince(account: string, since: Micros): Promise<MailUsage[]> {
    return withTx(this.deps.db, (tx) => repo.findCountedSince(tx, account, since), { readOnly: true });
  }

  /** Its own committed transaction (REQUIRES_NEW): an email that left stays counted. */
  async record(account: string, kind: string, recipients: number, outcome: MailOutcome, error: string | null, at: Micros): Promise<void> {
    const e = error == null || error.length <= MAX_ERROR_LENGTH ? error : error.slice(0, MAX_ERROR_LENGTH);
    await withTx(this.deps.db, (tx) => repo.insertSendLog(tx, account, kind, recipients, mailOutcomeDb(outcome), e, at));
  }

  async state(account: string): Promise<MailAccountState | null> {
    return withTx(this.deps.db, (tx) => repo.findAccountState(tx, account), { readOnly: true });
  }

  async saveState(account: string, state: MailAccountState, now: Micros): Promise<void> {
    await withTx(this.deps.db, (tx) => repo.saveAccountState(tx, account, state, now));
  }
}

// ------------------------------------------------------------ sender accounts

export const STATUS_CONNECTED = 'connected';
export const STATUS_BROKEN = 'broken';
export const STATUS_MISSING = 'missing';
export const OWNER_CEITBA = 'ceitba';
export const OWNER_ORGANIZATION = 'organization';

export const ERR_ACCESS_DENIED = 'access_denied';
export const ERR_INVALID_STATE = 'invalid_state';
export const ERR_NOT_STAFF = 'not_staff';
export const ERR_WRONG_ACCOUNT = 'wrong_account';
export const ERR_MISSING_SCOPE = 'missing_scope';
export const ERR_NO_REFRESH_TOKEN = 'no_refresh_token';
export const ERR_EXCHANGE_FAILED = 'exchange_failed';
export const ERR_NOT_ORG_ADMIN = 'not_org_admin';
export const ERR_WRONG_DOMAIN = 'wrong_domain';
export const ERR_ACCOUNT_IN_USE = 'account_in_use';
export const ERR_UNDECRYPTABLE = 'token cannot be decrypted — reconnect';

/** MailSenderAccountService.AccountView (record order). */
export interface AccountView {
  id: number;
  email: string;
  ownerType: string;
  ownerRef: string | null;
  status: string;
  connectedAt: string;
  lastError: string | null;
  lastUsedAt: string | null;
}

const odtFromDb = (pg: string | null) => (pg == null ? null : formatOffsetDateTime(parsePgTimestamp(pg)));

export function accountView(a: repo.SenderAccountRow): AccountView {
  return {
    id: a.id, email: a.email, ownerType: a.ownerType, ownerRef: a.ownerRef, status: a.status,
    connectedAt: odtFromDb(a.connectedAt)!, lastError: a.lastError, lastUsedAt: odtFromDb(a.lastUsedAt),
  };
}

/** The address that connected must be exactly the configured sender, verified. */
export function isSenderAccount(claims: IdClaims | null, expectedEmail: string): boolean {
  return claims != null && claims.emailVerified && claims.email != null
    && javaTrim(claims.email).toLowerCase() === javaTrim(expectedEmail).toLowerCase();
}

export function hasSendScope(scope: string | null | undefined): boolean {
  // Arrays.asList(scope.split("\\s+")).contains(SCOPE_SEND)
  return scope != null && scope.split(/[ \t\n\x0B\f\r]+/).includes(SCOPE_SEND);
}

function truncate500(s: string | null): string | null {
  return s == null ? null : s.length > 500 ? s.slice(0, 500) : s;
}

const domainOf = (address: string) => {
  const at = address.lastIndexOf('@');
  return at < 0 ? null : address.slice(at + 1);
};

export class MailSenderAccountService implements MailSenderAccounts {
  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly google: GoogleMailOAuthClient,
              private readonly states: MailOAuthStateService, private readonly ledger: MailLedger, private readonly log: Logger) {}

  /** The consent URL, and the nonce the route sets as the browser-binding cookie (MAIL_OAUTH_NONCE_COOKIE). */
  connect(staffUserId: string): { authorizationUrl: string; nonce: string } {
    this.requireConfigured();
    const sender = this.settings.email.account;
    const { state, nonce } = this.states.issueBound(staffUserId);
    return { authorizationUrl: this.google.authorizationUri(state, sender, domainOf(sender)), nonce };
  }

  /** An organization's admin picks any account of org-mail.allowed-domain. */
  connectOrg(orgSlug: string, adminId: string): { authorizationUrl: string; nonce: string } {
    this.requireConfigured();
    const { state, nonce } = this.states.issueBound(adminId, orgSlug);
    return { authorizationUrl: this.google.authorizationUri(state, null, this.settings.orgMail.allowedDomain), nonce };
  }

  private requireConfigured(): void {
    if (!this.google.configured()) {
      throw new FeatureNotConfiguredError('Gmail sender connection needs GOOGLE_CLIENT_ID, '
        + 'GOOGLE_CLIENT_SECRET and GOOGLE_MAIL_REDIRECT_URI');
    }
    this.cipher(); // fails fast without MAIL_TOKEN_ENCRYPTION_KEY
  }

  /**
   * Always returns where to send the browser; never throws. `cookieNonce`: the browser-binding cookie; a state
   * opened in another browser than the one that started the connect is invalid_state.
   */
  async handleCallback(code: string | null, state: string | null, error: string | null, cookieNonce: string | null): Promise<string> {
    const verified = this.states.verifyBound(state, cookieNonce);
    if (verified == null) return this.redirect(ERR_INVALID_STATE);
    if (verified.orgSlug != null) return this.handleOrgCallback(verified, code, error);
    const staff = await withTx(this.deps.db, (tx) => repo.isActiveStaffAt(tx, verified.userId, this.deps.clock.now()), { readOnly: true });
    if (!staff) return this.redirect(ERR_NOT_STAFF);
    if (error != null) return this.redirect(error === 'access_denied' ? ERR_ACCESS_DENIED : ERR_EXCHANGE_FAILED);
    if (code == null || javaIsBlank(code)) return this.redirect(ERR_EXCHANGE_FAILED);
    try {
      const tokens = await this.google.exchangeCode(code);
      const claims = this.google.parseIdToken(tokens.idToken);
      const expected = this.settings.email.account;
      if (!isSenderAccount(claims, expected)) return this.redirect(ERR_WRONG_ACCOUNT);
      if (!hasSendScope(tokens.scope)) return this.redirect(ERR_MISSING_SCOPE);
      if (tokens.refreshToken == null || javaIsBlank(tokens.refreshToken)) return this.redirect(ERR_NO_REFRESH_TOKEN);
      await this.store(expected, tokens.refreshToken, tokens.scope!, verified.userId);
      this.log.info(`Mail: sender account ${expected} connected by staff user ${verified.userId}`);
      return this.redirect(null);
    } catch (e) {
      // Class only: never tokens or Google's payload.
      this.log.warn(`Mail: connecting the sender account failed: ${(e as Error)?.constructor?.name ?? 'Error'}`);
      return this.redirect(ERR_EXCHANGE_FAILED);
    }
  }

  private async handleOrgCallback(state: MailOAuthState, code: string | null, error: string | null): Promise<string> {
    const slug = state.orgSlug!;
    if (!(await withTx(this.deps.db, (tx) => repo.isOrgAdmin(tx, state.userId, slug), { readOnly: true }))) return this.redirectOrg(slug, ERR_NOT_ORG_ADMIN);
    if (error != null) return this.redirectOrg(slug, error === 'access_denied' ? ERR_ACCESS_DENIED : ERR_EXCHANGE_FAILED);
    if (code == null || javaIsBlank(code)) return this.redirectOrg(slug, ERR_EXCHANGE_FAILED);
    try {
      const tokens = await this.google.exchangeCode(code);
      const claims = this.google.parseIdToken(tokens.idToken);
      if (claims == null || !claims.emailVerified || !orgMailAllows(this.settings, claims.email)) {
        return this.redirectOrg(slug, ERR_WRONG_DOMAIN);
      }
      const address = javaTrim(claims.email).toLowerCase();
      const existing = await withTx(this.deps.db, (tx) => repo.findAccountByEmailIgnoreCase(tx, address), { readOnly: true });
      if (existing != null && !(existing.ownerType === OWNER_ORGANIZATION && slug === existing.ownerRef)) {
        return this.redirectOrg(slug, ERR_ACCOUNT_IN_USE);
      }
      if (!hasSendScope(tokens.scope)) return this.redirectOrg(slug, ERR_MISSING_SCOPE);
      if (tokens.refreshToken == null || javaIsBlank(tokens.refreshToken)) return this.redirectOrg(slug, ERR_NO_REFRESH_TOKEN);
      await this.storeOrg(slug, address, tokens.refreshToken, tokens.scope!, state.userId);
      this.log.info(`Mail: org ${slug} connected sender account ${address}`);
      return this.redirectOrg(slug, null);
    } catch (e) {
      this.log.warn(`Mail: connecting the sender account of org ${slug} failed: ${(e as Error)?.constructor?.name ?? 'Error'}`);
      return this.redirectOrg(slug, ERR_EXCHANGE_FAILED);
    }
  }

  private async store(senderEmail: string, refreshToken: string, scopes: string, by: string): Promise<void> {
    const now = this.deps.clock.now();
    const enc = this.cipher().encrypt(refreshToken, senderEmail);
    await withTx(this.deps.db, async (tx) => {
      const row = await repo.findAccountByOwner(tx, OWNER_CEITBA, null);
      if (row == null || !javaEqualsIgnoreCase(row.email, senderEmail)) {
        // The replaced address's token is revoked at Google too, like a disconnect.
        if (row != null) await this.delete(row.id, tx);
        await repo.insertAccount(tx, senderEmail, OWNER_CEITBA, null, enc, scopes, by, now);
      } else {
        await repo.reconnectAccount(tx, row, enc, scopes, by, now);
      }
    });
    // A broken-sender backoff must not outlive the reconnection.
    await this.ledger.saveState(senderEmail, CLEAR, this.deps.clock.now());
  }

  /** One account per org: reconnecting with another address replaces it. */
  private async storeOrg(slug: string, senderEmail: string, refreshToken: string, scopes: string, by: string): Promise<void> {
    const now = this.deps.clock.now();
    const enc = this.cipher().encrypt(refreshToken, senderEmail);
    await withTx(this.deps.db, async (tx) => {
      const row = await repo.findAccountByOwner(tx, OWNER_ORGANIZATION, slug);
      if (row == null || !javaEqualsIgnoreCase(row.email, senderEmail)) {
        if (row != null) await this.delete(row.id, tx);
        await repo.insertAccount(tx, senderEmail, OWNER_ORGANIZATION, slug, enc, scopes, by, now);
      } else {
        await repo.reconnectAccount(tx, row, enc, scopes, by, now);
      }
    });
    await this.ledger.saveState(senderEmail, CLEAR, this.deps.clock.now());
  }

  async orgAccount(slug: string): Promise<AccountView | null> {
    const a = await withTx(ambientDb(this.deps.db), (tx) => repo.findAccountByOwner(tx, OWNER_ORGANIZATION, slug), { readOnly: true });
    return a == null ? null : accountView(a);
  }

  /** Revokes and deletes the org's account; no-op without one. `db`: the caller's transaction to join. */
  async disconnectOrg(slug: string, db: Db = this.deps.db): Promise<void> {
    await withTx(db, async (tx) => {
      const a = await repo.findAccountByOwner(tx, OWNER_ORGANIZATION, slug);
      if (a != null) await this.delete(a.id, tx);
    });
  }

  async list(): Promise<AccountView[]> {
    return (await withTx(this.deps.db, (tx) => repo.findAllAccounts(tx), { readOnly: true })).map(accountView);
  }

  /** Revokes the token at Google (best effort), then deletes the row. `db`: the caller's transaction to join. */
  async delete(id: number, db: Db = this.deps.db): Promise<void> {
    await withTx(db, async (tx) => {
      const row = await repo.findAccountById(tx, id);
      if (row == null) throw new ResourceNotFoundError('MailSenderAccount', String(id));
      try {
        await this.google.revoke(this.cipher().decrypt(row.refreshTokenEnc, row.email));
      } catch (e) {
        this.log.warn(`Mail: could not revoke the token of ${row.email} at Google (deleting anyway): ${(e as Error)?.constructor?.name ?? 'Error'}`);
      }
      await repo.deleteAccount(tx, row.id);
    });
  }

  /** connected | broken | missing, for the configured sender (CEITBA account). */
  async senderStatus(): Promise<string> {
    const a = await withTx(ambientDb(this.deps.db), (tx) => repo.findAccountByEmailIgnoreCase(tx, this.settings.email.account), { readOnly: true });
    if (a == null) return STATUS_MISSING;
    return a.status === STATUS_CONNECTED ? STATUS_CONNECTED : a.status === STATUS_BROKEN ? STATUS_BROKEN : STATUS_MISSING;
  }

  /**
   * The connected account for `senderEmail`, decrypted; null when missing,
   * broken or revoked. A stored token that cannot be decrypted marks it broken.
   * Joins the caller's transaction (ambientDb), like Spring's thread-bound one.
   */
  async credentialsFor(senderEmail: string): Promise<MailCredentials | null> {
    const db = ambientDb(this.deps.db);
    const a = await withTx(db, (tx) => repo.findAccountByEmailIgnoreCase(tx, senderEmail), { readOnly: true });
    if (a == null || a.status !== STATUS_CONNECTED) return null;
    let token: string;
    try {
      token = this.cipher().decrypt(a.refreshTokenEnc, a.email);
    } catch (e) {
      if (!(e instanceof TokenDecryptionError)) throw e;
      await withTx(db, (tx) => repo.markAccountBroken(tx, a.id, a.refreshTokenEnc, ERR_UNDECRYPTABLE));
      this.log.warn(`Mail: sender account ${a.email} is broken, reconnect it (${ERR_UNDECRYPTABLE})`);
      return null;
    }
    return { accountId: a.id, email: a.email, refreshToken: token, tokenEnc: a.refreshTokenEnc };
  }

  /** Why `senderEmail` cannot send right now, or null when it is usable. */
  async unavailableReason(senderEmail: string): Promise<string | null> {
    const a = await withTx(ambientDb(this.deps.db), (tx) => repo.findAccountByEmailIgnoreCase(tx, senderEmail), { readOnly: true });
    if (a == null) return `no connected Gmail sender account for ${senderEmail}`;
    if (a.status !== STATUS_CONNECTED) {
      return `Gmail sender account ${senderEmail} is broken${a.lastError == null ? '' : ` (${a.lastError})`}: reconnect it`;
    }
    try {
      if ((await this.credentialsFor(senderEmail)) == null) {
        return `Gmail sender account ${senderEmail} is broken (${ERR_UNDECRYPTABLE})`;
      }
    } catch (e) {
      if (e instanceof FeatureNotConfiguredError) return e.message;
      throw e;
    }
    return null;
  }

  /** Google rejected this token: reconnect needed. No-op if it was replaced meanwhile. */
  async markBroken(c: MailCredentials, error: string): Promise<void> {
    await withTx(ambientDb(this.deps.db), (tx) => repo.markAccountBroken(tx, c.accountId, c.tokenEnc, truncate500(error)));
    this.log.warn(`Mail: sender account ${c.email} is broken, reconnect it (${error})`);
  }

  async markUsed(c: MailCredentials): Promise<void> {
    await withTx(ambientDb(this.deps.db), (tx) => repo.markAccountUsed(tx, c.accountId, this.deps.clock.now()));
  }

  private cipher(): MailTokenCipher {
    if (javaIsBlank(this.settings.oauth.tokenEncryptionKey)) {
      throw new FeatureNotConfiguredError('MAIL_TOKEN_ENCRYPTION_KEY is not set (openssl rand -base64 32)');
    }
    return new MailTokenCipher(this.settings.oauth.tokenEncryptionKey);
  }

  private redirect(errorReason: string | null): string {
    const base = `${this.settings.digest.publicBaseUrl}/admin/digests`;
    return errorReason == null ? `${base}?mail=connected` : `${base}?mail=error&reason=${errorReason}`;
  }

  private redirectOrg(slug: string, errorReason: string | null): string {
    const base = `${this.settings.digest.publicBaseUrl}/mine/org/${slug}/mail`;
    return errorReason == null ? `${base}?mail=connected` : `${base}?mail=error&reason=${errorReason}`;
  }
}

// ------------------------------------------------------------ retention

export class MailRetentionService {
  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly log: Logger) {}

  /** One transaction (@Transactional). */
  async cleanup(): Promise<void> {
    const now = this.deps.clock.now();
    const trackingCutoff = now - this.settings.retention.trackingEventsMs * 1000;
    const [e, l, s, o] = await withTx(this.deps.db, async (tx) => [
      await repo.deleteTrackingEventsOlderThan(tx, trackingCutoff),
      await repo.deleteDeliveryLinksSentBefore(tx, trackingCutoff),
      await repo.deleteSendLogOlderThan(tx, now - this.settings.retention.sendLogMs * 1000),
      // Who got an org's email (names the recipients): kept as long as tracking data.
      await repo.deleteOrgDeliveriesFinishedBefore(tx, trackingCutoff),
    ]);
    this.log.info(`Mail retention: deleted ${e} tracking events, ${l} delivery links, ${s} send-log rows, ${o} org email deliveries`);
  }
}

// ------------------------------------------------------------ org senders

/**
 * OrgMailSenders.fromHeader: the org's name (member-editable) as the From
 * display name, control characters dropped. Approximates
 * InternetAddress(address, name, "UTF-8").toString(); the transport
 * (nodemailer) re-encodes the header anyway.
 */
export function orgFromHeader(address: string, displayName: string | null): string {
  const name = displayName == null ? '' : javaStrip(displayName.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/[ \t\n\x0B\f\r]+/g, ' '));
  if (name.length === 0) return address;
  if (/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]*$/.test(name)) return `${name} <${address}>`;
  return `"${name.replace(/["\\]/g, (c) => `\\${c}`)}" <${address}>`;
}

export class OrgMailSenders {
  private readonly byAccount = new Map<string, { from: string; service: MailSendService }>();

  constructor(private readonly beans: Pick<MailBeans, 'ledger' | 'settings'>, private readonly deps: Deps,
              /** From header -> transport for that account (MailConfig.orgTransport). Replaceable by tests. */
              public transportFor: (from: string) => EmailSender) {}

  /** The sender for `address`, shown as `displayName`. A renamed org gets a new sender for later sends. */
  forAccount(address: string, displayName: string | null): MailSendService {
    const account = javaTrim(address).toLowerCase();
    const from = orgFromHeader(account, displayName);
    const e = this.byAccount.get(account);
    if (e && e.from === from) return e.service;
    const s = this.beans.settings;
    const service = new MailSendService(this.transportFor(from), this.beans.ledger, {
      account, limit: this.limitFor(account), backoffInitialMs: s.email.backoffInitialMs, backoffMaxMs: s.email.backoffMaxMs,
      quotaPauseMs: s.email.quotaPauseMs, allowedRecipient: (to) => isAllowedRecipient(s, to),
      log: this.deps.log.child({ component: 'MailSendService' }),
    }, this.deps.clock);
    this.byAccount.set(account, { from, service });
    return service;
  }

  limitFor(account: string): number {
    return this.beans.settings.email.dailyLimits.get(account) ?? this.beans.settings.orgMail.dailyLimit;
  }
}

// ------------------------------------------------------------ wiring

export interface MailBeans {
  settings: MailSettings;
  ledger: MailLedger;
  google: GoogleMailOAuthClient;
  states: MailOAuthStateService;
  accounts: MailSenderAccountService;
  tokens: MailAccessTokenCache;
  /** THE CEITBA sender (MailConfig.emailSender). */
  sender: MailSendService;
  orgSenders: OrgMailSenders;
  retention: MailRetentionService;
}

const beansByDeps = new WeakMap<Deps, MailBeans>();

/** The mail singletons of this app instance (one per Deps, like Spring beans). */
export function mailBeans(deps: Deps): MailBeans {
  const hit = beansByDeps.get(deps);
  if (hit) return hit;
  const settings = mailSettings(deps.config);
  const log = deps.log.child({ component: 'mail' });
  const ledger = new DrizzleMailLedger(deps);
  const google = new GoogleMailOAuthClient(deps.config, settings.oauth.redirectUri, deps.clock);
  const states = new MailOAuthStateService(deps.config.auth.jwt.secret, deps.clock);
  const accounts = new MailSenderAccountService(deps, settings, google, states, ledger, log);
  const tokens = new MailAccessTokenCache((rt) => google.refresh(rt), deps.clock);
  const email = settings.email;
  const transport = ceitbaTransport(deps, settings, accounts, tokens, log);
  const sender = new MailSendService(transport, ledger, {
    account: email.account, limit: limitFor(settings, email.account), backoffInitialMs: email.backoffInitialMs,
    backoffMaxMs: email.backoffMaxMs, quotaPauseMs: email.quotaPauseMs, allowedRecipient: (to) => isAllowedRecipient(settings, to),
    log: deps.log.child({ component: 'MailSendService' }),
  }, deps.clock);
  const orgTokens = new MailAccessTokenCache((rt) => google.refresh(rt), deps.clock);
  const beans: MailBeans = {
    settings, ledger, google, states, accounts, tokens, sender,
    orgSenders: undefined as unknown as OrgMailSenders,
    retention: new MailRetentionService(deps, settings, log),
  };
  beans.orgSenders = new OrgMailSenders(beans, deps, (from) => orgTransport(deps, settings, accounts, orgTokens, from, log));
  beansByDeps.set(deps, beans);
  return beans;
}

/**
 * MailConfig.transport. deps.mailTransport is the raw transport selected by
 * src/infra/mail.ts (or a test's fake). With MAIL_ENABLED=true and
 * MAIL_TRANSPORT=gmail-api it is the GmailApiTransportSlot this feature fills
 * with its GmailApiEmailSender (it needs the sender-account service and the
 * OAuth token cache, which are beans of this feature).
 */
function ceitbaTransport(deps: Deps, s: MailSettings, accounts: MailSenderAccountService, tokens: MailAccessTokenCache,
                         log: Logger): EmailSender {
  if (deps.mailTransport instanceof GmailApiTransportSlot) {
    log.info(`Mail: Gmail API (OAuth) enabled, from ${s.email.from}`);
    return new GmailApiEmailSender(accounts, tokens, s.email.from);
  }
  return deps.mailTransport;
}

/** MailConfig.orgTransport: organizations send through the Gmail API only. */
function orgTransport(deps: Deps, s: MailSettings, accounts: MailSenderAccountService, tokens: MailAccessTokenCache,
                      from: string, log: Logger): EmailSender {
  if (!s.email.enabled) return s.email.logSends ? new LoggingEmailSender(log) : new DisabledEmailSender();
  if (s.email.transport === TRANSPORT_LOG) return new LoggingEmailSender(log);
  if (s.email.transport === TRANSPORT_GMAIL_API) return new GmailApiEmailSender(accounts, tokens, from);
  void deps;
  return new UnavailableEmailSender('Organizations send through the Gmail API only (MAIL_TRANSPORT=gmail-api)');
}

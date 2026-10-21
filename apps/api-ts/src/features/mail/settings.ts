// The normalization the Java *Properties records do in their compact
// constructors, over the raw values src/config/sections/content.ts parsed:
// config/EmailProperties, DigestProperties, DigestPersonalProperties,
// MailOAuthProperties, MailRetentionProperties, OrgMailProperties.
// One frozen object per Config (memoized).

import type { Config } from '../../config';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { addressOf } from './logic/gmailApiEmailSender';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const TRANSPORT_GMAIL_API = 'gmail-api';
export const TRANSPORT_SMTP = 'smtp';
export const TRANSPORT_LOG = 'log';
export const DEFAULT_FROM = 'CEITBA <ceitba@itba.edu.ar>';

export interface MailSettings {
  email: {
    enabled: boolean;
    transport: string;
    from: string;
    /** EmailProperties.account(): the address part of `from`, lower-cased. */
    account: string;
    logSends: boolean;
    dailyLimit: number;
    /** mail.daily-limits (yml only): none here. */
    dailyLimits: ReadonlyMap<string, number>;
    backoffInitialMs: number;
    backoffMaxMs: number;
    quotaPauseMs: number;
  };
  digest: {
    publicBaseUrl: string;
    apiBaseUrl: string;
    allowedDomains: string[];
    trackingEnabled: boolean;
    sendIntervalMs: number;
    tickIntervalMs: number;
    jobsEnabled: boolean;
  };
  personal: { wikiBaseUrl: string; schedulerUrl: string; voteTokenTtlMs: number; maxWikiLinks: number; maxCorrections: number };
  oauth: { redirectUri: string; tokenEncryptionKey: string };
  retention: { sendLogMs: number; trackingEventsMs: number };
  orgMail: { allowedDomain: string; dailyLimit: number; weeklyLimit: number; jobsEnabled: boolean; tickIntervalMs: number };
}

const stripSlash = (s: string) => javaTrim(s).replace(/\/+$/, '');

const cache = new WeakMap<object, MailSettings>();

export function mailSettings(config: Config): MailSettings {
  const hit = cache.get(config);
  if (hit) return hit;
  const m = config.content.mail;
  const d = config.content.digest;
  const o = config.content.orgMail;

  let transport = m.transport == null || javaIsBlank(m.transport) ? TRANSPORT_GMAIL_API : javaTrim(m.transport).toLowerCase();
  if (![TRANSPORT_GMAIL_API, TRANSPORT_SMTP, TRANSPORT_LOG].includes(transport)) {
    throw new Error(`MAIL_TRANSPORT must be gmail-api, smtp or log, not: ${transport}`);
  }
  const from = m.from == null || javaIsBlank(m.from) ? DEFAULT_FROM : m.from;
  const backoffInitialMs = m.backoffInitialMs > 0 ? m.backoffInitialMs : 5 * 60_000;
  const backoffMaxMs = m.backoffMaxMs < backoffInitialMs ? Math.max(backoffInitialMs, HOUR) : m.backoffMaxMs;

  const domains = d.allowedDomains.filter((x) => x != null && !javaIsBlank(x));
  const allowedDomains = domains.length === 0 ? ['itba.edu.ar'] : domains.map((x) => javaTrim(x).toLowerCase().replace(/^@/, ''));

  const p = d.personal;
  const s: MailSettings = {
    email: {
      enabled: m.enabled,
      transport,
      from,
      account: addressOf(from).toLowerCase(),
      logSends: m.logSends,
      dailyLimit: m.dailyLimit < 0 ? 1500 : m.dailyLimit,
      dailyLimits: new Map(),
      backoffInitialMs,
      backoffMaxMs,
      quotaPauseMs: m.quotaPauseMs < 0 ? 24 * HOUR : m.quotaPauseMs,
    },
    digest: {
      publicBaseUrl: stripSlash(javaIsBlank(d.publicBaseUrl) ? 'https://ceitba.org.ar/newsletter' : d.publicBaseUrl),
      apiBaseUrl: stripSlash(javaIsBlank(d.apiBaseUrl) ? 'https://ceitba.org.ar/api' : d.apiBaseUrl),
      allowedDomains,
      trackingEnabled: d.trackingEnabled,
      sendIntervalMs: d.sendIntervalMs < 0 ? 1000 : d.sendIntervalMs,
      tickIntervalMs: d.tickIntervalMs > 0 ? d.tickIntervalMs : 5 * 60_000,
      jobsEnabled: d.jobsEnabled,
    },
    personal: {
      wikiBaseUrl: javaIsBlank(p.wikiBaseUrl) ? 'https://ceitba.org.ar/apuntes' : stripSlash(p.wikiBaseUrl),
      schedulerUrl: javaIsBlank(p.schedulerUrl) ? 'https://ceitba.org.ar/app/horario' : javaTrim(p.schedulerUrl),
      voteTokenTtlMs: p.voteTokenTtlMs > 0 ? p.voteTokenTtlMs : 14 * DAY,
      maxWikiLinks: p.maxWikiLinks < 0 ? 5 : p.maxWikiLinks,
      maxCorrections: p.maxCorrections < 0 ? 3 : p.maxCorrections,
    },
    oauth: { redirectUri: javaTrim(m.oauthRedirectUri ?? ''), tokenEncryptionKey: javaTrim(m.tokenEncryptionKey ?? '') },
    retention: {
      sendLogMs: m.retentionSendLogMs < 2 * DAY ? 30 * DAY : m.retentionSendLogMs,
      trackingEventsMs: m.retentionTrackingMs > 0 ? m.retentionTrackingMs : 180 * DAY,
    },
    orgMail: {
      allowedDomain: javaIsBlank(o.allowedDomain) ? 'itba.edu.ar' : javaTrim(o.allowedDomain).toLowerCase(),
      dailyLimit: o.dailyLimit < 0 ? 400 : o.dailyLimit,
      weeklyLimit: o.weeklyLimit < 0 ? 3 : o.weeklyLimit,
      jobsEnabled: o.jobsEnabled,
      tickIntervalMs: o.tickIntervalMs,
    },
  };
  cache.set(config, s);
  return s;
}

/** DigestProperties.isAllowedRecipient: exact (case-insensitive) match of the address's only domain. */
export function isAllowedRecipient(s: MailSettings, email: string | null | undefined): boolean {
  if (email == null) return false;
  const e = javaTrim(email).toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0 || at !== e.indexOf('@') || at === e.length - 1) return false;
  return s.digest.allowedDomains.includes(e.slice(at + 1));
}

/** EmailProperties.limitFor */
export function limitFor(s: MailSettings, account: string | null): number {
  return s.email.dailyLimits.get(account == null ? '' : account.toLowerCase()) ?? s.email.dailyLimit;
}

/** OrgMailProperties.allows */
export function orgMailAllows(s: MailSettings, email: string | null | undefined): boolean {
  return email != null && email.toLowerCase().endsWith(`@${s.orgMail.allowedDomain}`);
}

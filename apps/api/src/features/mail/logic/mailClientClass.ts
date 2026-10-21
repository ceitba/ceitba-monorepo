// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailClientClass.java.
//
// Coarse class of the client behind an open/click, from its User-Agent: all
// that is stored about it (never the IP or the full UA). SCANNER marks
// security scanners, link checkers and bots: their events are recorded but
// flagged and excluded from stats.

import { javaIsBlank } from '../../../lib/javaCompat';

export const MAIL_CLIENT_CLASSES = ['GMAIL_PROXY', 'YAHOO_PROXY', 'OUTLOOK', 'BROWSER', 'SCANNER', 'UNKNOWN'] as const;
export type MailClientClass = (typeof MAIL_CLIENT_CLASSES)[number];

// Substrings (lower case) of known scanners / bots / non-browser clients.
const SCANNERS = [
  'bot', 'crawler', 'spider', 'slurp', 'scanner', 'preview', 'fetcher',
  'curl/', 'wget/', 'python', 'go-http-client', 'java/', 'okhttp', 'apache-httpclient', 'libwww',
  'httpclient', 'node-fetch', 'axios', 'headlesschrome', 'phantomjs', 'puppeteer', 'playwright',
  'barracuda', 'proofpoint', 'mimecast', 'symantec', 'messagelabs', 'trendmicro', 'forcepoint',
  'fireeye', 'sophos', 'cisco', 'ironport', 'zscaler', 'paloalto', 'checkpoint', 'kaspersky',
  'facebookexternalhit', 'whatsapp', 'telegram', 'discord', 'skypeuripreview'];

/** MailClientClass.db(): the stored value. */
export const mailClientClassDb = (c: MailClientClass): string => c.toLowerCase();

export const isScanner = (c: MailClientClass): boolean => c === 'SCANNER';

export function mailClientClassOf(userAgent: string | null | undefined): MailClientClass {
  if (userAgent == null || javaIsBlank(userAgent)) return 'SCANNER';
  const ua = userAgent.toLowerCase();
  // Mail providers' image proxies fetch the pixel when a person opens the email: real opens.
  if (ua.includes('googleimageproxy')) return 'GMAIL_PROXY';
  if (ua.includes('yahoomailproxy')) return 'YAHOO_PROXY';
  for (const s of SCANNERS) if (ua.includes(s)) return 'SCANNER';
  if (ua.includes('outlook') || ua.includes('microsoft office')) return 'OUTLOOK';
  if (ua.startsWith('mozilla/')) return 'BROWSER';
  return 'UNKNOWN';
}

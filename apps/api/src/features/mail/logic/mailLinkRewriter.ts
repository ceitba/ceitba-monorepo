// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailLinkRewriter.java.
//
// Open/click tracking of an email body (docs/WEEKLY-DIGEST.md):
//   - every http(s) link of the HTML part (href="…") and of the plain-text part
//     becomes `${trackingBase}/{linkId}`; the same URL gets the same id in both;
//   - links already known (the issue's shared links) keep their id, the others
//     are numbered from PERSONAL_BASE in order of appearance;
//   - the open pixel goes at the end of the HTML body;
//   - links the caller marks as untracked (the unsubscribe link) are left alone;
//   - in the plain-text part a URL ends before trailing sentence punctuation
//     (. , ; : ! ? and an unbalanced ")").
// Headers are never touched. The original URLs are returned so the caller
// stores them; the redirect endpoint resolves a link id only from that copy.

import { randomBytes } from 'node:crypto';
import { base64UrlEncode, javaStrip, javaTrim, replaceLiteral } from '../../../lib/javaCompat';

/** Link ids below this are the issue's shared links; from here on, the per-reader links of one delivery. */
export const PERSONAL_BASE = 1000;

export interface TrackedLink { id: number; url: string; urlKey: string; label: string }

export interface RewriteResult { html: string | null; text: string | null; personalLinks: TrackedLink[] }

// Java: Pattern.CASE_INSENSITIVE (ASCII folding) and ASCII \s.
const HREF = /href="([^"]*)"/gi;
const ANCHOR = /<a[ \t\n\x0B\f\r][^>]*?href="([^"]*)"[^>]*>(.*?)<\/a>/gis;
const TEXT_URL = /https?:\/\/[^ \t\n\x0B\f\r<>"]+/gi;
const TAG = /<[^>]*>/g;
const TOKEN_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_LABEL = 200;

/** A fresh opaque tracking id: 128 random bits, base64url (22 chars). Never derived from the user id. */
export function newTrackingId(): string {
  return base64UrlEncode(randomBytes(16));
}

export function isWellFormedTrackingId(id: string | null | undefined): boolean {
  return id != null && TOKEN_ID.test(id);
}

type Untracked = (url: string) => boolean;
const NONE: Untracked = () => false;

/**
 * The distinct http(s) links of a body, in order of appearance, with the
 * anchor text of their first labelled occurrence. `untracked` URLs get no id.
 */
export function collectLinks(html: string | null, text: string | null, untracked: Untracked = NONE): TrackedLink[] {
  const labels = labelsOf(html);
  const urls = new Set<string>();
  if (html != null) {
    for (const m of html.matchAll(HREF)) {
      const url = javaTrim(unescape(m[1]!));
      if (isHttp(url) && !untracked(url)) urls.add(url);
    }
  }
  if (text != null) {
    for (const m of text.matchAll(TEXT_URL)) {
      const url = trimTrailingPunctuation(m[0]);
      if (!untracked(url)) urls.add(url);
    }
  }
  let i = 0;
  return [...urls].map((url) => ({ id: ++i, url, urlKey: urlKey(url), label: labels.get(url) ?? urlKey(url) }));
}

/**
 * Rewrites both parts. `shared`: URL -> link id of the issue's links.
 * `trackingUrl`: link id -> the redirect URL. `pixelUrl`: the open pixel (null = none).
 * `untracked`: URLs left exactly as they are.
 */
export function rewriteLinks(html: string | null, text: string | null, shared: ReadonlyMap<string, number>,
                             trackingUrl: (id: number) => string, pixelUrl: string | null,
                             untracked: Untracked = NONE): RewriteResult {
  const labels = labelsOf(html);
  const personal = new Map<string, TrackedLink>();
  const ids = new Map(shared);
  const idFor = (url: string): number => {
    let id = ids.get(url);
    if (id === undefined) {
      id = PERSONAL_BASE + personal.size;
      personal.set(url, { id, url, urlKey: urlKey(url), label: labels.get(url) ?? urlKey(url) });
      ids.set(url, id);
    }
    return id;
  };

  let newHtml = html;
  if (html != null) {
    newHtml = html.replace(HREF, (whole: string, raw: string) => {
      const url = javaTrim(unescape(raw));
      return isHttp(url) && !untracked(url) ? `href="${escape(trackingUrl(idFor(url)))}"` : whole;
    });
    if (pixelUrl != null) newHtml = withPixel(newHtml, pixelUrl);
  }
  let newText = text;
  if (text != null) {
    newText = text.replace(TEXT_URL, (raw: string) => {
      const url = trimTrailingPunctuation(raw);
      return untracked(url) ? raw : trackingUrl(idFor(url)) + raw.slice(url.length);
    });
  }
  return { html: newHtml, text: newText, personalLinks: [...personal.values()] };
}

/**
 * A URL found in running text, without the punctuation that ends the
 * sentence: trailing . , ; : ! ? and a ")" that closes nothing inside the URL.
 */
export function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const c = url[end - 1]!;
    if ('.,;:!?'.includes(c)) end--;
    else if (c === ')' && unbalancedClose(url, end)) end--;
    else break;
  }
  return url.slice(0, end);
}

function unbalancedClose(s: string, end: number): boolean {
  let open = 0;
  let close = 0;
  for (let i = 0; i < end; i++) {
    if (s[i] === '(') open++;
    else if (s[i] === ')') close++;
  }
  return close > open;
}

/** The URL without its `token` query parameter (per-reader secrets), used to group clicks across readers. */
export function urlKey(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const query = hash < 0 ? url.slice(q + 1) : url.slice(q + 1, hash);
  const kept: string[] = [];
  // query.split("&"): trailing empty strings dropped, empty pieces skipped anyway.
  for (const p of query.split('&')) {
    if (p.length === 0) continue;
    const name = p.includes('=') ? p.slice(0, p.indexOf('=')) : p;
    if (name.toLowerCase() !== 'token') kept.push(p);
  }
  return url.slice(0, q) + (kept.length === 0 ? '' : `?${kept.join('&')}`);
}

export function withPixel(html: string, pixelUrl: string): string {
  const img = `<img src="${escape(pixelUrl)}" width="1" height="1" alt="" `
    + 'style="display:block;width:1px;height:1px;border:0;">';
  // Like Java, the index comes from the lower-cased copy.
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + img : html.slice(0, at) + img + html.slice(at);
}

function labelsOf(html: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (html == null) return out;
  for (const m of html.matchAll(ANCHOR)) {
    const url = javaTrim(unescape(m[1]!));
    const label = javaStrip(replaceLiteral(unescape(m[2]!.replace(TAG, ' ')), '→', '').replace(/[ \t\n\x0B\f\r]+/g, ' '));
    if (label.length > 0 && !out.has(url)) out.set(url, label.length <= MAX_LABEL ? label : label.slice(0, MAX_LABEL));
  }
  return out;
}

function isHttp(url: string): boolean {
  const u = url.toLowerCase();
  return u.startsWith('https://') || u.startsWith('http://');
}

export function unescape(s: string): string {
  let r = replaceLiteral(s, '&quot;', '"');
  r = replaceLiteral(r, '&#39;', "'");
  r = replaceLiteral(r, '&lt;', '<');
  r = replaceLiteral(r, '&gt;', '>');
  return replaceLiteral(r, '&amp;', '&');
}

function escape(s: string): string {
  let r = replaceLiteral(s, '&', '&amp;');
  r = replaceLiteral(r, '"', '&quot;');
  r = replaceLiteral(r, '<', '&lt;');
  r = replaceLiteral(r, '>', '&gt;');
  return replaceLiteral(r, "'", '&#39;');
}

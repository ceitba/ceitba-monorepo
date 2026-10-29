// service/news/NewsSitemapService + web/news/NewsSitemapController.xml: the URLs
// behind /sitemap.xml (Caddy rewrites it to GET /api/v1/articles/sitemap.xml):
// the newsletter home, every published article and the events list with every
// event, the same sets the anonymous GET /v1/articles and GET /v1/events list.
// The result is kept for 10 minutes (by the injected clock): crawlers refetch it often.

import { withTx } from '../../db/client';
import type { Deps } from '../../deps';
import type { Clock } from '../../infra/clock';
import { ART, localDateOf, toMicros, type Micros } from '../../lib/time';
import { htmlEscapeUtf8 } from './preview';
import * as repo from './repo';

/** sitemaps.org allows 50,000 URLs per file. */
export const MAX_URLS = 50_000;
const TTL_MICROS = 10 * 60 * 1_000_000;

export interface SitemapEntry { url: string; lastModified: string | null }

/** The two lean queries (ids and dates, no bodies); tests pass an in-memory one. */
export interface SitemapSource {
  publishedArticles(limit: number): Promise<repo.SitemapRow[]>;
  eventIds(from: string, to: string, limit: number): Promise<string[]>;
}

export function dbSitemapSource(deps: Deps): SitemapSource {
  return {
    publishedArticles: (limit) => withTx(deps.db, (tx) => repo.findPublishedForSitemap(tx, limit), { readOnly: true }),
    eventIds: (from, to, limit) => withTx(deps.db, (tx) => repo.findEventIdsForSitemap(tx, from, to, limit), { readOnly: true }),
  };
}

export class NewsSitemapService {
  // Two requests racing past an expired entry both rebuild; harmless.
  private cached: { entries: SitemapEntry[]; builtAt: Micros } | null = null;

  /** `newsletterUrl` = DIGEST_PUBLIC_BASE_URL (must match the site origin robots.txt and the canonicals use). */
  constructor(private readonly source: SitemapSource, private readonly clock: Clock, private readonly newsletterUrl: string) {}

  async entries(): Promise<SitemapEntry[]> {
    const hit = this.cached;
    const now = this.clock.now();
    if (hit !== null && now - hit.builtAt < TTL_MICROS) return hit.entries;
    const built = await this.build();
    this.cached = { entries: built, builtAt: now };
    return built;
  }

  private async build(): Promise<SitemapEntry[]> {
    const entries: SitemapEntry[] = [{ url: this.newsletterUrl, lastModified: null }];
    for (const a of await this.source.publishedArticles(MAX_URLS - entries.length)) {
      entries.push({ url: `${this.newsletterUrl}/articles/${segment(a.id)}`, lastModified: lastModified(a) });
    }
    if (entries.length < MAX_URLS) entries.push({ url: `${this.newsletterUrl}/events`, lastModified: null });
    // Events have no updatedAt, so no lastmod. The bounds are the ones
    // NewsEventService.findAll applies to an unfiltered list.
    if (entries.length < MAX_URLS) {
      for (const id of await this.source.eventIds('1900-01-01', '2999-12-31', MAX_URLS - entries.length)) {
        entries.push({ url: `${this.newsletterUrl}/events/${segment(id)}`, lastModified: null });
      }
    }
    return Object.freeze(entries) as SitemapEntry[];
  }
}

/**
 * JS encodeURIComponent, which the SPA's canonical uses: everything but
 * A-Z a-z 0-9 - _ . ! ~ * ' ( ) is UTF-8 percent-encoded (UriUtils would
 * leave pchars like + : @ & = alone).
 */
export function segment(id: string): string {
  let out = '';
  for (const b of Buffer.from(id, 'utf8')) {
    const c = String.fromCharCode(b);
    const plain = (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || "-_.!~*'()".includes(c);
    out += plain ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** updatedAt as a Buenos Aires date, else publishedAt. */
function lastModified(a: repo.SitemapRow): string | null {
  if (a.updatedAt !== null) return localDateOf(toMicros(a.updatedAt), ART);
  return a.publishedAt;
}

/** NewsSitemapController.xml. */
export function sitemapXml(entries: SitemapEntry[]): string {
  let sb = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const e of entries) {
    sb += `  <url><loc>${htmlEscapeUtf8(e.url)}</loc>`;
    if (e.lastModified !== null) sb += `<lastmod>${e.lastModified}</lastmod>`;
    sb += '</url>\n';
  }
  return `${sb}</urlset>\n`;
}

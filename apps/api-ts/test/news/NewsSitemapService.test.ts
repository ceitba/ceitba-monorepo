// Port of apps/api/src/test/java/org/ceitba/api/service/news/NewsSitemapServiceTest.java.
import { describe, expect, test } from 'bun:test';
import { MutableClock } from '../../src/infra/clock';
import type { SitemapRow } from '../../src/features/news/repo';
import { NewsSitemapService, segment, sitemapXml, type SitemapSource } from '../../src/features/news/sitemap';

function source(...answers: SitemapRow[][]): SitemapSource {
  let call = 0;
  return {
    publishedArticles: async () => answers[Math.min(call++, answers.length - 1)]!,
    eventIds: async () => [],
  };
}
const MINUTE = 60_000;

describe('NewsSitemapServiceTest', () => {
  test('lastmodIsTheBuenosAiresDateOfUpdatedAtElsePublishedAt', async () => {
    const clock = new MutableClock('2026-10-20T12:00:00Z');
    // 01:00Z is still the previous day in Buenos Aires (UTC-3).
    const service = new NewsSitemapService(source([
      { id: 'updated', updatedAt: '2026-10-10 01:00:00+00', publishedAt: '2026-01-01' },
      { id: 'never-updated', updatedAt: null, publishedAt: '2026-10-05' },
    ]), clock, 'https://ceitba.org.ar/newsletter');
    const lastmod = Object.fromEntries((await service.entries()).filter((e) => e.lastModified !== null).map((e) => [e.url, e.lastModified]));
    expect(lastmod['https://ceitba.org.ar/newsletter/articles/updated']).toBe('2026-10-09');
    expect(lastmod['https://ceitba.org.ar/newsletter/articles/never-updated']).toBe('2026-10-05');
  });

  test('entriesAreMemoisedForTenMinutes', async () => {
    const clock = new MutableClock('2026-10-20T12:00:00Z');
    const first = { id: 'first', updatedAt: null, publishedAt: '2026-10-05' };
    const service = new NewsSitemapService(source([first], [first, { id: 'second', updatedAt: null, publishedAt: '2026-10-06' }]),
      clock, 'https://ceitba.org.ar/newsletter');
    // Home + first article + events list.
    expect(await service.entries()).toHaveLength(3);
    clock.advance(9 * MINUTE);
    expect(await service.entries()).toHaveLength(3);
    clock.advance(2 * MINUTE);
    expect(await service.entries()).toHaveLength(4);
  });

  test('segmentEncodesLikeEncodeURIComponent', () => {
    for (const id of ['a+b:c', 'charla ia', "x-_.!~*'()y", 'ñandú/€', 'a&b=c@d']) expect(segment(id)).toBe(encodeURIComponent(id));
  });

  test('xmlEscapesTheUrls', () => {
    expect(sitemapXml([{ url: 'https://x.org/a&b<"\'>', lastModified: '2026-01-02' }]))
      .toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + '  <url><loc>https://x.org/a&amp;b&lt;&quot;&#39;&gt;</loc><lastmod>2026-01-02</lastmod></url>\n</urlset>\n');
  });
});

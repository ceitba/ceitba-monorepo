// Ports apps/api/src/test/java/org/ceitba/api/web/news/NewsSitemapIT.java,
// plus a byte-level check of the document and its headers.
import { beforeEach, describe, expect, test } from 'bun:test';
import { useServer } from '../support';
import { seedArticle, seedEvent, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();

describe('NewsSitemapIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedArticle(api.db, { id: 'a1', title: 'Publicado', excerpt: 'excerpt', body: ['p'], category: 'tech', authors: ['Ian'], publishedAt: '2026-10-10', status: 'published' });
    const ev = { title: 'Evento', startTime: '18:00', endTime: '20:00', location: 'Aula 101', category: 'general' };
    await seedEvent(api.db, { ...ev, id: 'sitemap-evt', eventDate: '2026-11-03' });
    await seedEvent(api.db, { ...ev, id: 'charla ia', title: 'Charla', eventDate: '2026-11-04' });
    await seedEvent(api.db, { ...ev, id: 'a+b:c', title: 'Mas', eventDate: '2026-11-05' });
    for (const status of ['draft', 'pending_review']) {
      await seedArticle(api.db, { id: `h-${status}`, title: 'Hidden', excerpt: 'excerpt', body: ['p'], category: 'tech', authors: ['A'], status });
    }
  });

  test('listsPublishedArticlesAndEventsWithoutASession', async () => {
    const r = await api.get('/v1/articles/sitemap.xml', { headers: { Accept: 'text/html' } });
    expect(r.status).toBe(200);
    // Served by the sitemap handler, not ArticleController's GET /{id}.
    expect(r.headers.get('content-type')).toBe('application/xml;charset=UTF-8');
    expect(r.headers.get('cache-control')).toBe('max-age=3600, public');
    const [{ lastmod }] = await api.db`SELECT (updated_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS lastmod FROM public.articles WHERE id = 'a1'`;
    expect(r.text).toBe('<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + '  <url><loc>https://ceitba.org.ar/newsletter</loc></url>\n'
      + `  <url><loc>https://ceitba.org.ar/newsletter/articles/a1</loc><lastmod>${lastmod}</lastmod></url>\n`
      + '  <url><loc>https://ceitba.org.ar/newsletter/events</loc></url>\n'
      + '  <url><loc>https://ceitba.org.ar/newsletter/events/sitemap-evt</loc></url>\n'
      // Ids are percent-encoded like the SPA's encodeURIComponent.
      + '  <url><loc>https://ceitba.org.ar/newsletter/events/charla%20ia</loc></url>\n'
      + '  <url><loc>https://ceitba.org.ar/newsletter/events/a%2Bb%3Ac</loc></url>\n'
      + '</urlset>\n');
    expect(r.text).not.toContain('h-draft');
    expect(r.text).not.toContain('h-pending_review');
  });
});

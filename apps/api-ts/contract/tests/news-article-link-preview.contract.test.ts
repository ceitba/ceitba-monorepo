// Ports apps/api/src/test/java/org/ceitba/api/web/news/ArticleLinkPreviewIT.java,
// plus byte-level checks of the page and its headers.
import { beforeEach, describe, expect, test } from 'bun:test';
import { useServer } from '../support';
import { seedArticle, seedOrg, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Apuntes &quot;CEITBA&quot; &lt;nuevo&gt;</title>
<meta name="description" content="Casi todos estudiamos con el resumen de alguien.">
<link rel="canonical" href="https://ceitba.org.ar/newsletter/articles/a1">
<meta property="og:type" content="article">
<meta property="og:locale" content="es_AR">
<meta property="og:site_name" content="CEITBA · ITBA News">
<meta property="og:title" content="Apuntes &quot;CEITBA&quot; &lt;nuevo&gt;">
<meta property="og:description" content="Casi todos estudiamos con el resumen de alguien.">
<meta property="og:url" content="https://ceitba.org.ar/newsletter/articles/a1">
<meta property="og:image" content="https://ceitba.org.ar/ceitba-media/m/foto.jpg">
<meta property="article:published_time" content="2026-10-10">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<h1>Apuntes &quot;CEITBA&quot; &lt;nuevo&gt;</h1>
<p>Casi todos estudiamos con el resumen de alguien.</p>
<p><a href="https://ceitba.org.ar/newsletter/articles/a1">Leer en ITBA News</a></p>
</body>
</html>
`;

const NOT_FOUND = '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>ITBA News</title></head>'
  + '<body><p>Artículo no encontrado.</p></body></html>\n';

describe('ArticleLinkPreviewIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
    await seedArticle(api.db, {
      id: 'a1', title: 'Apuntes "CEITBA" <nuevo>', excerpt: '', category: 'Académico', authors: ['Ian'],
      body: ['Casi todos estudiamos con el **resumen** de [alguien](https://x.org).', '![image](https://ceitba.org.ar/ceitba-media/m/foto.jpg)'],
      organization: 'ceitba', publishedAt: '2026-10-10', status: 'published',
    });
    await seedArticle(api.db, { id: 'a2', title: 'Draft', excerpt: 'excerpt', body: ['p'], category: 'tech', authors: ['A'], status: 'draft' });
  });

  test('publishedArticleHasOpenGraphTagsWithoutASession', async () => {
    const r = await api.get('/v1/articles/a1/preview', { headers: { 'User-Agent': 'WhatsApp/2.23.20.0' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/html;charset=UTF-8');
    expect(r.headers.get('cache-control')).toBe('max-age=300, public');
    expect(r.text).toContain('<meta property="og:title" content="Apuntes &quot;CEITBA&quot; &lt;nuevo&gt;">');
    expect(r.text).toContain('<meta property="og:description" content="Casi todos estudiamos con el resumen de alguien.">');
    expect(r.text).toContain('<meta property="og:url" content="https://ceitba.org.ar/newsletter/articles/a1">');
    expect(r.text).toContain('<meta property="og:image" content="https://ceitba.org.ar/ceitba-media/m/foto.jpg">');
    expect(r.text).toContain('content="CEITBA · ITBA News"');
    expect(r.text).not.toContain('<nuevo>');
    expect(r.text).toBe(PAGE);
  });

  test('draftsAndUnknownArticlesAre404', async () => {
    for (const id of ['a2', 'nope']) {
      const r = await api.get(`/v1/articles/${id}/preview`, { headers: { Accept: 'text/html' } });
      expect(r.status).toBe(404);
      expect(r.headers.get('content-type')).toBe('text/html;charset=UTF-8');
      // No Cache-Control from the controller: Spring Security's default applies.
      expect(r.headers.get('cache-control')).toBe('no-cache, no-store, max-age=0, must-revalidate');
      expect(r.text).toBe(NOT_FOUND);
    }
  });

  // Without a cover or body image the org's logo is used (made absolute), and
  // a long first paragraph is cut at 200 characters.
  test('logoFallbackAndLongDescription', async () => {
    await api.db`UPDATE public.organizations SET logo_url = '/ceitba-media/logo.png', name = 'Org & "Co"' WHERE slug = 'ceitba'`;
    const long = `${'palabra '.repeat(40)}fin`;
    await seedArticle(api.db, { id: 'a3', title: "It's <b>", excerpt: '  ', body: ['# ', `  ${long}`], category: 'Campus', authors: ['A'], organization: 'ceitba' });
    const r = await api.get('/v1/articles/a3/preview');
    expect(r.status).toBe(200);
    const desc = long.slice(0, 199).trim() + '…';
    expect(r.text).toContain(`<meta name="description" content="${desc}">`);
    expect(r.text).toContain('<meta property="og:image" content="https://ceitba.org.ar/ceitba-media/logo.png">');
    expect(r.text).toContain('<meta property="og:site_name" content="Org &amp; &quot;Co&quot; · ITBA News">');
    expect(r.text).toContain('<title>It&#39;s &lt;b&gt;</title>');
    expect(r.text).not.toContain('article:published_time');
    expect(r.text).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  test('noImageAtAll', async () => {
    await seedArticle(api.db, { id: 'a4', title: 'Solo', excerpt: 'Resumen\n\ten  dos', body: ['texto'], category: 'Campus', authors: ['A'], publishedAt: '2026-01-02' });
    const r = await api.get('/v1/articles/a4/preview');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<meta name="description" content="Resumen en dos">');
    expect(r.text).toContain('<meta property="og:site_name" content="ITBA News">');
    expect(r.text).not.toContain('og:image');
    expect(r.text).toContain('<meta name="twitter:card" content="summary">');
  });
});

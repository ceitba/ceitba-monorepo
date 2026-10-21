// Port of apps/api/src/test/java/org/ceitba/api/service/digest/DigestRendererTest.java
// (+ `interop:` byte-for-byte comparisons with DigestRenderer's Java output).
import { describe, expect, test } from 'bun:test';
import type { DigestArticle, DigestEvent, DigestOrg } from '../../src/features/digest/logic/digestContent';
import {
  digestTemplate, NEW_EVENTS, NO_EVENTS_NEXT_WEEK, type DigestTemplate,
} from '../../src/features/digest/logic/digestRenderer';
import { DigestWeek } from '../../src/features/digest/logic/digestWeek';
import { INTEROP } from '../interop/java-golden';

const WEEK = new DigestWeek('2026-09-28');
const ORG: DigestOrg = { slug: 'ceitba', name: 'CEITBA <b>&</b>' };
const UNSUB = 'https://ceitba.org.ar/newsletter/unsubscribe?token=abc';

const art = (id: string, title: string, excerpt: string | null, cover: string | null, publishedAt: string | null,
             org: DigestOrg | null): DigestArticle => ({ id, title, excerpt, coverImage: cover, publishedAt, organization: org });
const ev = (id: string, title: string, date: string, start: string | null, end: string | null, location: string | null,
            org: DigestOrg | null, signup: boolean): DigestEvent =>
  ({ id, title, eventDate: date, startTime: start, endTime: end, location, organization: org, signup });

function template(intro: string | null, a: DigestArticle | null, e: DigestEvent | null): DigestTemplate {
  return digestTemplate({ subject: 'Asunto', week: WEEK, intro, digest: { articles: a ? [a] : [], events: e ? [e] : [] },
    publicBaseUrl: 'https://ceitba.org.ar/newsletter' });
}
const render = (intro: string | null, a: DigestArticle | null, e: DigestEvent | null) => template(intro, a, e).forReader(null, UNSUB);

const idx = (s: string, sub: string) => s.indexOf(sub);

describe('DigestRendererTest', () => {
  test('escapesUserContent', () => {
    const a = art('id"><script>', '<script>alert(1)</script>', 'x & "y"', null, '2026-09-30', ORG);
    const e = ev('e1', '<img src=x onerror=alert(1)>', '2026-10-06', '18:00', '20:00', 'Aula <101>', ORG, false);
    const html = render('Hola <i>todos</i>\nsegunda línea', a, e).html;

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<i>todos');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('x &amp; &quot;y&quot;');
    expect(html).toContain('Hola &lt;i&gt;todos&lt;/i&gt;<br>segunda línea');
    expect(html).toContain('Aula &lt;101&gt;');
    expect(html).toContain('CEITBA &lt;b&gt;&amp;&lt;/b&gt;');
    // The id is URL-encoded in the link, so it cannot break out of href.
    expect(html).toContain('/articles/id%22%3E%3Cscript%3E');
    // The unsubscribe URL is an attribute too.
    expect(template(null, null, null).forReader(null, 'https://x/"><b>').html).toContain('href="https://x/&quot;&gt;&lt;b&gt;"');
  });

  test('coverImageOnlyWhenAbsoluteHttpUrl', () => {
    const rel = art('a1', 'T', 'E', '/ceitba-media/x.jpg', '2026-09-30', ORG);
    expect(render(null, rel, null).html).not.toContain('<img');
    const js = art('a1', 'T', 'E', 'javascript:alert(1)', '2026-09-30', ORG);
    expect(render(null, js, null).html).not.toContain('<img');
    const abs = art('a1', 'T', 'E', 'https://ceitba.org.ar/ceitba-media/x.jpg', '2026-09-30', ORG);
    expect(render(null, abs, null).html).toContain('<img src="https://ceitba.org.ar/ceitba-media/x.jpg"');
  });

  test('sectionsLinksFooterAndPlainText', () => {
    const a = art('a1', 'Título', 'Resumen', null, '2026-09-30', null);
    const e = ev('e1', 'Charla', '2026-10-06', '18:00', '20:00', 'Aula 101', null, false);
    const out = render(null, a, e);
    for (const s of ['La semana en ITBA', 'Lo que pasó', 'Lo que viene', 'https://ceitba.org.ar/newsletter/articles/a1',
      'Independiente', 'Charla', `href="${UNSUB}"`, '18:00 a 20:00 hs', 'seguís a CEITBA en ITBA News']) {
      expect(out.html).toContain(s);
    }
    expect(out.html.endsWith('</html>')).toBe(true);
    expect(out.html).not.toContain('/organizations');
    for (const s of ['LO QUE PASÓ', 'Título', 'Charla', 'Martes 6 de octubre', 'https://ceitba.org.ar/newsletter/articles/a1',
      'seguís a CEITBA en ITBA News', `Dejar de recibir este resumen: ${UNSUB}`]) {
      expect(out.text).toContain(s);
    }
  });

  test('personalSectionGoesBetweenContentAndFooter', () => {
    const t = template(null, null, null);
    const out = t.forReader({ html: '<tr><td>TU CUATRI</td></tr>', text: 'TU CUATRI' }, UNSUB);
    expect(idx(out.html, 'TU CUATRI')).toBeGreaterThan(idx(out.html, 'Lo que viene'));
    expect(idx(out.html, 'TU CUATRI')).toBeLessThan(idx(out.html, 'seguís a CEITBA'));
    expect(idx(out.text, 'TU CUATRI')).toBeGreaterThan(idx(out.text, 'LO QUE VIENE'));
    expect(idx(out.text, 'TU CUATRI')).toBeLessThan(idx(out.text, 'seguís a CEITBA'));
    // Only the per-reader parts differ between two readers.
    const other = t.forReader(null, 'https://other');
    expect(other.html).not.toContain('TU CUATRI');
    expect(other.html).toContain('https://other');
  });

  test('laterEventsGoUnderNewEventsAndEveryEventLinksToItsPage', () => {
    const soon = ev('e1', 'Charla', '2026-10-06', '18:00', '20:00', 'Aula 101', null, false);
    const later = ev('e 2', 'Hackathon', '2026-11-20', '09:00', '18:00', 'SDF', ORG, true);
    const out = digestTemplate({ subject: 'Asunto', week: WEEK, intro: null, digest: { articles: [], events: [soon, later] },
      publicBaseUrl: 'https://ceitba.org.ar/newsletter' }).forReader(null, UNSUB);

    for (const s of ['https://ceitba.org.ar/newsletter/events/e1', 'Ver evento →',
      'https://ceitba.org.ar/newsletter/events/e%202', 'Ver evento e inscribirse →']) expect(out.html).toContain(s);
    expect(out.html).not.toContain(NO_EVENTS_NEXT_WEEK);
    expect(idx(out.html, 'Hackathon')).toBeGreaterThan(idx(out.html, NEW_EVENTS));
    expect(idx(out.html, 'Hackathon')).toBeGreaterThan(idx(out.html, 'Charla'));
    expect(out.text).toContain('NUEVOS EVENTOS');
    expect(out.text).toContain('https://ceitba.org.ar/newsletter/events/e%202');

    // Only later events: next week is empty, the new ones still show.
    const onlyLater = digestTemplate({ subject: 'Asunto', week: WEEK, intro: null, digest: { articles: [], events: [later] },
      publicBaseUrl: 'https://ceitba.org.ar/newsletter' }).forReader(null, UNSUB).html;
    for (const s of [NO_EVENTS_NEXT_WEEK, NEW_EVENTS, 'Hackathon']) expect(onlyLater).toContain(s);
  });

  test('emptySectionsSaySo', () => {
    const html = render(null, null, null).html;
    expect(html).toContain('no hubo artículos nuevos');
    expect(html).toContain('No hay eventos anunciados');
  });
});

describe('interop: DigestRenderer byte-for-byte against Java', () => {
  for (const c of INTEROP.digestRender) {
    test(c.name, () => {
      const out = digestTemplate({ subject: c.input.subject, week: new DigestWeek(c.input.weekStart), intro: c.input.intro,
        digest: { articles: c.input.articles, events: c.input.events }, publicBaseUrl: c.input.publicBaseUrl })
        .forReader(c.input.personal, c.input.unsubscribeUrl);
      expect(out.html).toBe(c.html);
      expect(out.text).toBe(c.text);
    });
  }
});

// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MailLinkRewriterTest.java
import { describe, expect, test } from 'bun:test';
import {
  collectLinks, isWellFormedTrackingId, newTrackingId, rewriteLinks, trimTrailingPunctuation, urlKey,
} from '../../src/features/mail/logic/mailLinkRewriter';
import { INTEROP } from '../interop/java-golden';

const BASE = 'https://ceitba.org.ar/api/v1/mail';
const TID = 'AbCdEfGhIjKlMnOpQrStUv';
const trackingUrl = (id: number) => `${BASE}/c/${TID}/${id}`;

const HTML = '<html><head></head><body>'
  + '<a href="https://ceitba.org.ar/newsletter/articles/a1"><img src="https://cdn.example/cover.png" alt=""></a>'
  + '<h2><a href="https://ceitba.org.ar/newsletter/articles/a1" style="x">Título &amp; <b>más</b></a></h2>'
  + '<a href="https://ceitba.org.ar/newsletter/articles/a1">Leer más →</a>'
  + '<a target="_blank" href="https://ceitba.org.ar/newsletter/correction?token=u1.c1.99.SIG&amp;vote=confirm">Sí, es así</a>'
  + '<a href="https://ceitba.org.ar/newsletter/unsubscribe?token=u1.SIG%3D">Dejar de recibir</a>'
  + '<a href="mailto:ceitba@itba.edu.ar">mail</a>'
  + '</body></html>';

const TEXT = '* Título\n  https://ceitba.org.ar/newsletter/articles/a1\n'
  + '  Sí: https://ceitba.org.ar/newsletter/correction?token=u1.c1.99.SIG&vote=confirm\n'
  + 'Dejar de recibir: https://ceitba.org.ar/newsletter/unsubscribe?token=u1.SIG%3D\n';

const isUnsubscribe = (url: string) => url.startsWith('https://ceitba.org.ar/newsletter/unsubscribe');

describe('MailLinkRewriterTest', () => {
  test('everyHttpLinkOfBothPartsIsWrappedAndThePixelAppended', () => {
    const shared = new Map([['https://ceitba.org.ar/newsletter/articles/a1', 1]]);
    const r = rewriteLinks(HTML, TEXT, shared, trackingUrl, `${BASE}/o/${TID}.gif`, isUnsubscribe);

    // No original http(s) link left in an href or in the text, except the unsubscribe link.
    expect(/href="https?:\/\/(?!ceitba\.org\.ar\/api\/v1\/mail\/c\/|ceitba\.org\.ar\/newsletter\/unsubscribe)/.test(r.html!)).toBe(false);
    expect(r.html).toContain('href="https://ceitba.org.ar/newsletter/unsubscribe?token=u1.SIG%3D"');
    expect(r.text).toContain('Dejar de recibir: https://ceitba.org.ar/newsletter/unsubscribe?token=u1.SIG%3D\n');
    expect(r.text).not.toContain('newsletter/articles');
    expect(r.text).not.toContain('newsletter/correction');
    // The shared article link keeps its id (three anchors + text: one id).
    expect(r.html).toContain(`href="${trackingUrl(1)}"`);
    expect(r.text).toContain(trackingUrl(1));
    // Images are not links: the cover src is untouched; non-http hrefs too.
    expect(r.html).toContain('src="https://cdn.example/cover.png"');
    expect(r.html).toContain('href="mailto:ceitba@itba.edu.ar"');
    // Per-reader links numbered from 1000, same id in HTML and text.
    expect(r.personalLinks).toHaveLength(1);
    const vote = r.personalLinks[0]!;
    expect(vote.id).toBe(1000);
    // The HTML-escaped href (&amp;) is stored as the real URL.
    expect(vote.url).toBe('https://ceitba.org.ar/newsletter/correction?token=u1.c1.99.SIG&vote=confirm');
    expect(vote.urlKey).toBe('https://ceitba.org.ar/newsletter/correction?vote=confirm');
    expect(vote.label).toBe('Sí, es así');
    expect(r.text).toContain(`Sí: ${trackingUrl(1000)}`);
    // Pixel right before </body>, after everything else.
    expect(r.html!.endsWith(`<img src="${BASE}/o/${TID}.gif" width="1" height="1" alt="" `
      + 'style="display:block;width:1px;height:1px;border:0;"></body></html>')).toBe(true);
  });

  test('collectGivesDistinctLinksWithTheirFirstRealLabel', () => {
    const links = collectLinks(HTML, TEXT, isUnsubscribe);
    expect(links.map((l) => l.id)).toEqual([1, 2]);
    // The image link has no text: the title anchor's label is used.
    expect(links[0]!.label).toBe('Título & más');
    expect(links[0]!.url).toBe('https://ceitba.org.ar/newsletter/articles/a1');
  });

  test('textUrlsDoNotSwallowTrailingPunctuation', () => {
    expect(trimTrailingPunctuation('https://x.org/a.')).toBe('https://x.org/a');
    expect(trimTrailingPunctuation('https://x.org/a?q=1,')).toBe('https://x.org/a?q=1');
    expect(trimTrailingPunctuation('https://x.org/a!?;:')).toBe('https://x.org/a');
    // "(see https://x.org/a)": the ")" closes the sentence's parenthesis.
    expect(trimTrailingPunctuation('https://x.org/a)')).toBe('https://x.org/a');
    expect(trimTrailingPunctuation('https://x.org/a).')).toBe('https://x.org/a');
    // A balanced one belongs to the URL.
    expect(trimTrailingPunctuation('https://x.org/a_(b)')).toBe('https://x.org/a_(b)');
    expect(trimTrailingPunctuation('https://x.org/a_(b))')).toBe('https://x.org/a_(b)');

    // Collected and rewritten alike: the punctuation stays outside the link.
    const text = 'Mirá (https://x.org/a), o https://x.org/b_(c). Fin: https://x.org/d!';
    const links = collectLinks(null, text);
    expect(links.map((l) => l.url)).toEqual(['https://x.org/a', 'https://x.org/b_(c)', 'https://x.org/d']);
    const r = rewriteLinks(null, text, new Map(), trackingUrl, null);
    expect(r.text).toBe(`Mirá (${trackingUrl(1000)}), o ${trackingUrl(1001)}. Fin: ${trackingUrl(1002)}!`);
  });

  test('urlKeyDropsOnlyTheToken', () => {
    expect(urlKey('https://x.org/a?token=s&vote=reject')).toBe('https://x.org/a?vote=reject');
    expect(urlKey('https://x.org/a?TOKEN=s')).toBe('https://x.org/a');
    expect(urlKey('https://x.org/a/b?vista=wiki')).toBe('https://x.org/a/b?vista=wiki');
    expect(urlKey('https://x.org/a')).toBe('https://x.org/a');
  });

  test('trackingIdsAreRandomAndOpaque', () => {
    const a = newTrackingId();
    const b = newTrackingId();
    expect(a).toHaveLength(22);
    expect(a).not.toBe(b);
    expect(isWellFormedTrackingId(a)).toBe(true);
    expect(isWellFormedTrackingId('../../etc')).toBe(false);
    expect(isWellFormedTrackingId('short')).toBe(false);
    expect(isWellFormedTrackingId(null)).toBe(false);
  });
});

describe('interop: MailLinkRewriter against Java', () => {
  for (const c of INTEROP.linkRewriter ?? []) {
    test(c.name, () => {
      const shared = new Map<string, number>(Object.entries(c.shared as Record<string, number>));
      const untracked = (u: string) => u.startsWith(c.untrackedPrefix);
      const r = rewriteLinks(c.html, c.text, shared, trackingUrl, c.pixel, untracked);
      expect(r.html).toBe(c.out.html);
      expect(r.text).toBe(c.out.text);
      expect(r.personalLinks).toEqual(c.out.personalLinks);
      expect(collectLinks(c.html, c.text, untracked)).toEqual(c.collected);
    });
  }
});

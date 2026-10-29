// Port of apps/api/src/test/java/org/ceitba/api/service/drive/GoogleDocsHtmlTest.java
// A Google Docs HTML export (trimmed, in Google's format) through
// GoogleDocsHtml + DocHtmlSanitizer, as the Doc processing runs them.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sanitizeDocHtml } from '../../src/features/drive/logic/docHtmlSanitizer';
import { cssSelectors, normalizeGoogleDocsHtml, olType, parseCss } from '../../src/features/drive/logic/googleDocsHtml';
import { innerHtml, parseBodyFragment, text } from '../../src/features/drive/logic/jsoupDom';
import { INTEROP } from '../interop/java-golden';

const fixture = () => readFileSync(new URL('./fixtures/google-doc-export.html', import.meta.url), 'utf8');

function sanitized(raw = fixture(), prefix = '/assets/'): Element {
  const html = sanitizeDocHtml(normalizeGoogleDocsHtml(raw), new Map(), prefix).html;
  return parseBodyFragment(html).body;
}

// jsoup selector helpers: "> tag" (direct children) and descendants.
const kids = (el: Element, tag: string) => [...el.children].filter((c) => c.localName === tag);
const all = (el: Element, css: string) => [...el.querySelectorAll(css)];
const textOf = (els: Element[]) => els.map(text).filter((t) => t.length > 0).join(' ');

describe('GoogleDocsHtmlTest', () => {
  test('inlineFormattingAndAlignment', () => {
    const body = sanitized();
    const intro = all(body, 'p')[1]!;
    expect(textOf(all(intro, 'strong'))).toBe('negrita');
    expect(textOf(all(intro, 'em'))).toBe('cursiva');
    expect(textOf(all(intro, 'u'))).toBe('subrayado');
    expect(textOf(all(intro, 's'))).toBe('tachado');
    expect(textOf(all(intro, 'sup'))).toBe('2');
    expect(intro.getAttribute('data-align')).toBe('center');
    expect(textOf(all(all(body, 'p')[0]!, 'strong'))).toBe('Final de Gestión');
    // Link styling is not an underline tag.
    expect(all(body, 'a u')).toEqual([]);
    expect(innerHtml(body)).not.toContain('class=');
    expect(innerHtml(body)).not.toContain('style=');
  });

  test('flatListsBecomeNested', () => {
    const body = sanitized();
    const top = kids(body, 'ul');
    expect(top).toHaveLength(1);
    const items = kids(top[0]!, 'li');
    expect(items).toHaveLength(2);
    expect(textOf(kids(items[0]!, 'span').flatMap((s) => kids(s, 'strong')))).toBe('Planeamiento');
    const level1 = kids(items[0]!, 'ul').flatMap((u) => kids(u, 'li'));
    expect(level1).toHaveLength(3);
    expect(text(level1[0]!)).toBe('Estratégico');
    expect(textOf(kids(level1[1]!, 'ul').flatMap((u) => kids(u, 'li')))).toBe('Corto plazo');
    expect(text(level1[2]!)).toBe('Operativo');
    expect(text(items[1]!)).toBe('Control');
  });

  test('orderedListsKeepTypeAndNumbering', () => {
    const body = sanitized();
    const ols = kids(body, 'ol');
    expect(ols).toHaveLength(2);
    const first = ols[0]!;
    expect(first.getAttribute('type')).toBe('1');
    expect(kids(first, 'li')).toHaveLength(2);
    const sub = kids(kids(first, 'li')[0]!, 'ol')[0]!;
    expect(sub.getAttribute('type')).toBe('a');
    expect(kids(sub, 'li')).toHaveLength(2);
    // After the interruption numbering continues at 3.
    expect(ols[1]!.getAttribute('start')).toBe('3');
    expect(text(ols[1]!)).toBe('Tercero');
  });

  test('indentedParagraphsBecomeBlockquotes', () => {
    const body = sanitized();
    expect(textOf(all(body, 'blockquote'))).toBe('Cita indentada');
    // List items with margin-left are not blockquotes.
    expect(all(body, 'li blockquote')).toEqual([]);
  });

  // Current exports: formatting inline, lists still by class (real sample, trimmed).
  test('inlineStylesFromCurrentExports', () => {
    const raw = '<html><head><style>.lst-kix_3hg-0>li:before{content:"\\0025cf   "}'
      + '.lst-kix_3hg-1>li:before{content:"\\0025cb   "}</style></head><body>'
      + '<ul class="lst-kix_3hg-0 start"><li style="margin-left:36pt"><span>Sistemas</span></li></ul>'
      + '<ul class="lst-kix_3hg-1 start"><li><span>La </span><span style="color:#000000;font-weight:700;'
      + 'text-decoration:underline;vertical-align:baseline;font-style:normal">Ley 19550 </span></li></ul>'
      + '<p style="margin-left:36pt;text-align:right"><span style="font-style:italic">nota</span></p></body></html>';
    const body = sanitized(raw, '/a/');
    const nested = kids(body, 'ul').flatMap((u) => kids(u, 'li')).flatMap((l) => kids(l, 'ul')).flatMap((u) => kids(u, 'li'))[0]!;
    expect(textOf(all(nested, 'strong > u'))).toBe('Ley 19550');
    expect(textOf(all(body, 'blockquote > p[data-align=right] em'))).toBe('nota');
    expect(innerHtml(body)).not.toContain('style=');
  });

  test('parsesFlatCss', () => {
    const rules = parseCss('@import url(x);.c1,.c2{font-weight:700;color:red}.a>li:before{content:"x"}');
    expect([...rules.keys()]).toEqual(['.c1', '.c2', '.a>li:before']);
    expect(rules.get('.c2')!.get('font-weight')).toBe('700');
    expect(olType('lower-roman')).toBe('i');
  });
});

/** Also modulo inter-tag whitespace (kept from when the port printed compactly). */
const compact = (s: string) => s.replace(/>\s+</g, '><').replace(/^\s+|\s+$/g, '').replace(/\n\s*/g, ' ');

describe('interop: GoogleDocsHtml + DocHtmlSanitizer against jsoup', () => {
  test('css selectors', () => {
    expect(cssSelectors('@import url(x);.c1,.c2{font-weight:700;color:red}.a>li:before{content:"x"} ol.lst-kix_x-1 { list-style-type: lower-roman } p{}'))
      .toEqual(INTEROP.cssSelectors);
  });
  for (const c of INTEROP.docHtml) {
    test(`sanitize(normalize(raw)) ${c.name}: byte-identical html, same text and assets`, () => {
      const r = sanitizeDocHtml(normalizeGoogleDocsHtml(c.raw), new Map([['images/image1.png', 'image1.png']]), '/assets/');
      expect(r.html).toBe(c.html); // byte-identical to jsoup (pretty-print whitespace included)
      expect(compact(r.html)).toBe(compact(c.html));
      expect(r.text).toBe(c.text);
      expect(r.usedAssets).toEqual(c.used);
    });
  }
});

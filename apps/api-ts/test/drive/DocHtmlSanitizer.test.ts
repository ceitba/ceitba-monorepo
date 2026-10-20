// Port of apps/api/src/test/java/org/ceitba/api/service/drive/DocHtmlSanitizerTest.java
import { describe, expect, test } from 'bun:test';
import { sanitizeDocHtml, unwrapGoogleRedirect } from '../../src/features/drive/logic/docHtmlSanitizer';
import { INTEROP } from '../interop/java-golden';

const PREFIX = '/api/v1/wiki/files/abc/assets/';

describe('DocHtmlSanitizerTest', () => {
  test('rewritesKnownImagesAndDropsTheRest', () => {
    const html = `<html><head><style>.c1{color:red}</style><script>alert(1)</script></head>
<body class="doc"><p class="c1" style="color:red">Hola <b>mundo</b></p>
<img src="images/image1.png" style="width:10px" onerror="alert(1)">
<img src="images/missing.png">
<img src="https://evil.example/track.gif">
<img src="data:image/png;base64,AAAA">
<iframe src="https://evil.example"></iframe>
</body></html>`;
    const r = sanitizeDocHtml(html, new Map([['images/image1.png', 'image1.png']]), PREFIX);

    expect(r.html).toContain(`<img src="${PREFIX}image1.png"`);
    for (const s of ['style', 'class=', 'script', 'onerror', 'iframe', 'evil.example', 'missing.png', 'data:image']) {
      expect(r.html).not.toContain(s);
    }
    expect(r.html).toContain('<b>mundo</b>');
    expect(r.usedAssets).toEqual(['image1.png']);
    expect(r.text).toBe('Hola mundo');
  });

  test('decodesImageSourcesWrittenUrlEncoded', () => {
    const r = sanitizeDocHtml('<img src="images/image%201.png">', new Map([['images/image 1.png', 'image_1.png']]), PREFIX);
    expect(r.usedAssets).toEqual(['image_1.png']);
  });

  test('unwrapsGoogleRedirectsAndHardensLinks', () => {
    const r = sanitizeDocHtml('<a href="https://www.google.com/url?q=https://itba.edu.ar/x%3Fa%3D1&sa=D">ITBA</a>'
      + '<a href="javascript:alert(1)">bad</a>', new Map(), PREFIX);
    expect(r.html).toContain('href="https://itba.edu.ar/x?a=1"');
    expect(r.html).toContain('rel="nofollow noopener noreferrer"');
    expect(r.html).not.toContain('javascript');
  });
});

/** Java pretty-prints in GoogleDocsHtml.normalize (we don't): compare modulo whitespace between tags. */
const compact = (s: string) => s.replace(/>\s+</g, '><').replace(/^\s+|\s+$/g, '').replace(/\n\s*/g, ' ');

describe('interop: DocHtmlSanitizer against jsoup', () => {
  test('unwrapGoogleRedirect matrix', () => {
    for (const [href, expected] of INTEROP.unwrap) {
      let got: string;
      try {
        got = unwrapGoogleRedirect(href);
      } catch {
        got = 'ERR';
      }
      expect([href, got]).toEqual([href, expected]);
    }
  });
  for (const c of INTEROP.docHtml) {
    test(`sanitize(raw) ${c.name}: same html modulo inter-tag whitespace, same text`, () => {
      const r = sanitizeDocHtml(c.raw, new Map([['images/image1.png', 'image1.png']]), '/assets/');
      expect(compact(r.html)).toBe(compact(c.rawHtml));
      expect(r.text).toBe(c.rawText);
    });
  }
});

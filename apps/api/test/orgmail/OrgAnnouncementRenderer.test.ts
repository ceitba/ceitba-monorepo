// Port of apps/api/src/test/java/org/ceitba/api/service/orgmail/OrgAnnouncementRendererTest.java
// (+ `interop:` byte-for-byte comparisons with the Java renderer).
import { describe, expect, test } from 'bun:test';
import { renderOrgAnnouncement } from '../../src/features/orgmail/logic/orgAnnouncementRenderer';
import { INTEROP } from '../interop/java-golden';

describe('OrgAnnouncementRendererTest', () => {
  test('escapesTheBodyAndLinksOnlyHttpUrls', () => {
    const out = renderOrgAnnouncement('SABF & co', 'violet',
      '<script>alert(1)</script>\n\nMirá https://sabf.org.ar/inscripcion?a=1&b=2. Y javascript:alert(1)',
      'https://x/unsubscribe?token=t', 'https://x/organizations/sabf');

    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('<a href="https://sabf.org.ar/inscripcion?a=1&amp;b=2"');
    expect(out.html).not.toContain('href="javascript:');
    expect(out.html).toContain('SABF &amp; co');
    expect(out.html).toContain('#6D28D9');
    expect(out.text).toContain('https://x/unsubscribe?token=t');
  });

  test('aQuotedOrBracketedUrlStopsAtItsDelimiter', () => {
    const html = renderOrgAnnouncement('O', null, 'Mirá "https://a.org/x" y <https://b.org>', 'u', 'p').html;
    expect(html).toContain('&quot;<a href="https://a.org/x" style="color:#1A3C6E">https://a.org/x</a>&quot;');
    expect(html).toContain('&lt;<a href="https://b.org"');
  });

  test('blankLinesStartParagraphsAndSingleNewlinesBreakLines', () => {
    const html = renderOrgAnnouncement('O', null, 'uno\ndos\n\ntres', 'u', 'p').html;
    expect(html).toContain('>uno<br>dos</p>');
    expect(html).toContain('>tres</p>');
  });
});

describe('interop: OrgAnnouncementRenderer byte-for-byte against Java', () => {
  for (const c of INTEROP.orgRender ?? []) {
    test(c.name, () => {
      const out = renderOrgAnnouncement(c.orgName, c.color, c.body, c.unsubscribeUrl, c.portalUrl);
      expect(out.html).toBe(c.html);
      expect(out.text).toBe(c.text);
    });
  }
});

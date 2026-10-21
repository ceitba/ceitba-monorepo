// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MailClientClassTest.java
import { describe, expect, test } from 'bun:test';
import { mailClientClassOf as of } from '../../src/features/mail/logic/mailClientClass';

describe('MailClientClassTest', () => {
  test('classifiesProxiesBrowsersAndScanners', () => {
    expect(of('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)')).toBe('GMAIL_PROXY');
    expect(of('YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html')).toBe('YAHOO_PROXY');
    expect(of('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe('BROWSER');
    expect(of('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17928)')).toBe('OUTLOOK');
    for (const ua of ['', null, 'curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 (compatible; Googlebot/2.1)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0', 'Barracuda Sentinel',
      'Mozilla/5.0 Proofpoint URL Defense', 'facebookexternalhit/1.1', 'Go-http-client/1.1']) {
      expect(of(ua)).toBe('SCANNER');
    }
  });
});

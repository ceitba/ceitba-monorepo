// Port of apps/api/src/main/java/org/ceitba/api/service/orgmail/OrgAnnouncementRenderer.java.
//
// The email of an organization's announcement: the org's name on a band of
// its color, the body as written (plain text: escaped, blank lines start a
// paragraph, http(s) URLs become links; never raw HTML) and a footer with the
// one-click unsubscribe link. Escaping is Spring's HtmlUtils.htmlEscape
// (HTML 4 named entities: "á" -> "&aacute;"), byte-for-byte like Java.

import { JAVA_R, javaSplit, javaStrip, javaIsBlank } from '../../../lib/javaCompat';
import { springHtmlEscape } from './springHtmlEscape';

export interface RenderedAnnouncement { html: string; text: string }

// [^\s<>"]+[^\s<>"'.,;:!?)\]] with Java's ASCII \s, by code point.
const URL = /https?:\/\/[^ \t\n\x0B\f\r<>"]+[^ \t\n\x0B\f\r<>"'.,;:!?)\]]/gu;
const COLORS: Record<string, string> = { blue: '#1A3C6E', amber: '#B87005', green: '#047857', violet: '#6D28D9' };
// \R\s*\R (Java's \R is not atomic: a CRLF alone is a paragraph break, like in Java).
const PARAGRAPH_BREAK = new RegExp(`${JAVA_R}[ \\t\\n\\x0B\\f\\r]*${JAVA_R}`, 'g');
const LINE_BREAK = /\r\n|[\n\x0B\f\r\u0085\u2028\u2029]/g;

const esc = (s: string) => springHtmlEscape(s)!;

export function renderOrgAnnouncement(orgName: string, color: string | null, body: string, unsubscribeUrl: string,
                                      portalUrl: string): RenderedAnnouncement {
  const band = Object.hasOwn(COLORS, color ?? '') ? COLORS[color ?? '']! : COLORS.blue!;
  const paragraphs: string[] = [];
  for (const p of javaSplit(javaStrip(body), PARAGRAPH_BREAK)) {
    if (javaIsBlank(p)) continue;
    paragraphs.push(`<p style="margin:0 0 16px;line-height:1.6">${linkify(javaStrip(p)).replace(LINE_BREAK, '<br>')}</p>`);
  }
  const name = esc(orgName);
  const html = '<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f5f3ef">\n'
    + '<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1c1917">\n'
    + `<div style="background:${band};color:#ffffff;padding:20px 24px;font:bold 20px Georgia,serif">${name}</div>\n`
    + `<div style="background:#ffffff;padding:24px;font-size:16px">${paragraphs.join('\n')}</div>\n`
    + '<div style="padding:16px 24px;font:12px/1.5 Arial,sans-serif;color:#57534e">\n'
    + `Recibís este correo porque seguís a <a href="${esc(portalUrl)}" style="color:#57534e">${name}</a> en ITBA News.\n`
    + `<a href="${esc(unsubscribeUrl)}" style="color:#57534e">Dejar de recibir correos de ${name}</a>.\n`
    + '</div></div></body></html>\n';
  const text = `${orgName}\n\n${javaStrip(body)}\n\n--\nRecibís este correo porque seguís a ${orgName}`
    + ` en ITBA News. Dejar de recibir sus correos: ${unsubscribeUrl}\n`;
  return { html, text };
}

/**
 * Escapes `text` and links its URLs. URLs are found in the raw text, so one in
 * quotes or angle brackets doesn't swallow the escaped delimiter.
 */
export function linkify(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL)) {
    const url = esc(m[0]);
    out += `${esc(text.slice(last, m.index))}<a href="${url}" style="color:#1A3C6E">${url}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

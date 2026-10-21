// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestRenderer.java.
//
// Renders an issue as table-based, inline-styled HTML (what email clients
// reliably support) plus a plain-text alternative, byte-for-byte like Java.
// Every piece of user content goes through esc()/attr().
//
// Composable: template() renders the shared content once per issue;
// DigestTemplate.forReader() then only splices in each recipient's optional
// personal section (between the content and the footer) and their unsubscribe link.

import {
  dayOfMonth, dayOfWeek, ES_DAYS_SHORT, ES_MONTHS_SHORT, isJavaWhitespace, javaCharToUpperCase, javaIsBlank,
  javaStrip, javaTrim, javaUrlEncode, monthOf, replaceLiteral, type LocalDate,
} from '../../../lib/javaCompat';
import type { DigestArticle, DigestEvent, DigestOrg, DigestShared } from './digestContent';
import { DigestWeek, longDate } from './digestWeek';

export interface DigestRenderInput {
  subject: string;
  week: DigestWeek;
  intro: string | null;
  digest: DigestShared;
  publicBaseUrl: string;
}

export interface DigestRenderOutput { html: string; text: string }

/** DigestPersonalSection.Section: html is inserted verbatim (built from escaped content). */
export interface PersonalSection { html: string | null; text: string | null }

/** The shared rendering, cut where the per-reader parts go. */
export class DigestTemplate {
  constructor(readonly htmlBody: string, readonly htmlFooterStart: string, readonly htmlFooterEnd: string,
              readonly textBody: string, readonly textFooterStart: string) {}

  forReader(personal: PersonalSection | null, unsubscribeUrl: string): DigestRenderOutput {
    const hasPersonal = personal != null;
    const html = this.htmlBody
      + (hasPersonal && personal.html != null ? personal.html : '')
      + this.htmlFooterStart + attr(unsubscribeUrl) + this.htmlFooterEnd;
    const text = this.textBody
      + (hasPersonal && personal.text != null ? `\n${javaStrip(personal.text)}\n` : '')
      + this.textFooterStart + unsubscribeUrl + '\n';
    return { html, text };
  }
}

// Footer copy (docs/WEEKLY-DIGEST.md).
export const WHY = 'Recibís este resumen semanal porque seguís a CEITBA en ITBA News.';
export const UNSUBSCRIBE = 'Dejar de recibir este resumen';
// Open/click tracking notice (docs/WEEKLY-DIGEST.md).
export const TRACKING = 'Medimos aperturas y clics para mejorar el resumen.';

// Palette (EDITORIAL_UI_SYSTEM.md).
const PRIMARY = '#1A3C6E';
const PRIMARY_50 = '#EEF3FA';
const ACCENT = '#F5A623';
const ACCENT_50 = '#FEF8EC';
const SURFACE = '#FAFAF8';
const INK = '#1C1C1E';
const INK_2 = '#6B7280';
const BORDER = '#E5E7EB';

const DISPLAY = "Fraunces, 'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Source Sans 3', Lato, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";

export const NO_EVENTS_NEXT_WEEK = 'No hay eventos anunciados para la semana que viene.';
export const NEW_EVENTS = 'Nuevos eventos';
export const NEW_EVENTS_SUBTITLE = 'Anunciados esta semana: anotate con tiempo';

export function digestTemplate(input: DigestRenderInput): DigestTemplate {
  const linkStyle = `color:${PRIMARY};text-decoration:underline;`;
  const muted = `font-family:${BODY};font-size:13px;line-height:21px;color:${INK_2};`;
  const htmlFooterStart = '<tr><td class="px" style="padding:32px 40px 32px 40px;">'
    + `<div style="border-top:1px solid ${BORDER};padding-top:20px;${muted}">`
    + `<p style="margin:0 0 10px 0;">${esc(WHY)} ${esc(TRACKING)}</p>`
    + `<p style="margin:0 0 10px 0;"><a target="_blank" style="${linkStyle}" href="`;
  const htmlFooterEnd = `">${esc(UNSUBSCRIBE)}</a></p>`
    + '<p style="margin:0;">CEITBA · Centro de Estudiantes del ITBA</p>'
    + '</div></td></tr></table></td></tr></table></body></html>';
  const textFooterStart = `\n--\n${WHY}\n${TRACKING}\n${UNSUBSCRIBE}: `;
  return new DigestTemplate(htmlBody(input), htmlFooterStart, htmlFooterEnd, textBody(input), textFooterStart);
}

export function renderDigest(input: DigestRenderInput, personal: PersonalSection | null, unsubscribeUrl: string): DigestRenderOutput {
  return digestTemplate(input).forReader(personal, unsubscribeUrl);
}

// ---------------------------------------------------------------- HTML

function htmlBody(input: DigestRenderInput): string {
  const d = input.digest;
  let sb = '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light">'
    + `<title>${esc(input.subject)}</title>`
    + '<style>@media only screen and (max-width:620px){'
    + '.container{width:100% !important}.px{padding-left:20px !important;padding-right:20px !important}'
    + '.h1{font-size:30px !important;line-height:36px !important}}</style>'
    + '</head>'
    + `<body style="margin:0;padding:0;background:${SURFACE};">`
    // Preheader (inbox preview line), hidden in the body.
    + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">'
    + `${esc(preheader(d))}</div>`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
    + `${SURFACE};"><tr><td align="center" style="padding:24px 12px;">`
    + '<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" '
    + `style="width:600px;max-width:600px;background:#FFFFFF;border:1px solid ${BORDER}`
    + ';border-radius:4px;">';

  sb += header(input);
  if (input.intro != null && !javaIsBlank(input.intro)) sb += intro(input.intro);

  sb += sectionLabel('Lo que pasó', `Artículos publicados del ${input.week.rangeLabel()}`);
  if (d.articles.length === 0) sb += emptyRow('Esta semana no hubo artículos nuevos.');
  else for (const a of d.articles) sb += article(a, input.publicBaseUrl);

  const next = new DigestWeek(input.week.eventsFrom());
  const nextWeek = nextWeekEvents(input);
  const later = laterEvents(input);
  sb += sectionLabel('Lo que viene', `Eventos del ${next.rangeLabel()}`);
  if (nextWeek.length === 0) sb += emptyRow(NO_EVENTS_NEXT_WEEK);
  for (const e of nextWeek) sb += event(e, input.publicBaseUrl);
  if (later.length > 0) {
    sb += sectionLabel(NEW_EVENTS, NEW_EVENTS_SUBTITLE);
    for (const e of later) sb += event(e, input.publicBaseUrl);
  }
  if (d.events.length > 0) {
    sb += '<tr><td class="px" style="padding:4px 40px 8px 40px;">'
      + link(`${input.publicBaseUrl}/events`, 'Ver todos los eventos →',
        `font-family:${BODY};font-size:15px;font-weight:600;color:${PRIMARY};text-decoration:none;`)
      + '</td></tr>';
  }
  return sb;
}

function header(input: DigestRenderInput): string {
  return `<tr><td class="px" style="background:${PRIMARY}`
    + `;padding:32px 40px 28px 40px;border-radius:4px 4px 0 0;border-bottom:4px solid ${ACCENT};">`
    + `<div style="font-family:${MONO};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:`
    + `${ACCENT};">ITBA News · CEITBA</div>`
    + `<h1 class="h1" style="margin:10px 0 6px 0;font-family:${DISPLAY}`
    + ';font-size:38px;line-height:44px;font-weight:700;color:#FFFFFF;">La semana en ITBA</h1>'
    + `<div style="font-family:${MONO};font-size:13px;color:#C9D6EA;">`
    + `${esc(capitalize(input.week.rangeLabel()))}</div>`
    + '</td></tr>';
}

function intro(text: string): string {
  return '<tr><td class="px" style="padding:28px 40px 4px 40px;">'
    + `<div style="font-family:${BODY};font-size:17px;line-height:28px;color:${INK}`
    + `;border-left:3px solid ${ACCENT};background:${ACCENT_50}`
    + ';padding:14px 18px;">'
    + multiline(text)
    + '</div></td></tr>';
}

function sectionLabel(title: string, subtitle: string): string {
  return '<tr><td class="px" style="padding:32px 40px 8px 40px;">'
    + `<div style="font-family:${MONO};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:`
    + `${PRIMARY};">${esc(title)}</div>`
    + `<div style="font-family:${BODY};font-size:14px;color:${INK_2}`
    + `;padding-top:2px;border-bottom:1px solid ${BORDER};padding-bottom:10px;">`
    + `${esc(subtitle)}</div></td></tr>`;
}

function emptyRow(message: string): string {
  return `<tr><td class="px" style="padding:12px 40px;font-family:${BODY}`
    + `;font-size:15px;line-height:24px;color:${INK_2};">`
    + `${esc(message)}</td></tr>`;
}

function article(a: DigestArticle, base: string): string {
  const url = articleUrl(base, a.id);
  let sb = '<tr><td class="px" style="padding:16px 40px 8px 40px;">';
  if (isAbsoluteHttpUrl(a.coverImage)) {
    sb += `<a href="${attr(url)}" style="text-decoration:none;">`
      + `<img src="${attr(javaTrim(a.coverImage!))}" width="520" alt="" `
      + 'style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:3px;margin-bottom:12px;">'
      + '</a>';
  }
  sb += `<div style="font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:`
    + `${INK_2};">`
    + esc(orgLabel(a.organization));
  if (a.publishedAt != null) sb += ` · ${esc(shortDate(a.publishedAt))}`;
  sb += '</div>'
    + `<h2 style="margin:6px 0 6px 0;font-family:${DISPLAY}`
    + ';font-size:22px;line-height:29px;font-weight:700;">'
    + link(url, a.title, `color:${INK};text-decoration:none;`)
    + '</h2>';
  if (a.excerpt != null && !javaIsBlank(a.excerpt)) {
    sb += `<p style="margin:0 0 6px 0;font-family:${BODY}`
      + `;font-size:16px;line-height:25px;color:${INK_2};">`
      + `${esc(a.excerpt)}</p>`;
  }
  sb += link(url, 'Leer más →', `font-family:${BODY};font-size:14px;font-weight:600;color:${PRIMARY};text-decoration:none;`)
    + '</td></tr>';
  return sb;
}

function event(e: DigestEvent, base: string): string {
  const url = eventUrl(base, e.id);
  const date = e.eventDate;
  let sb = '<tr><td class="px" style="padding:12px 40px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    // Date block
    + '<td width="64" valign="top" style="width:64px;">'
    + `<div style="background:${PRIMARY_50};border-radius:3px;text-align:center;padding:8px 0;">`
    + `<div style="font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:`
    + `${PRIMARY};">${esc(weekdayShort(date))}</div>`
    + `<div style="font-family:${DISPLAY};font-size:24px;line-height:28px;font-weight:700;color:`
    + `${PRIMARY};">${dayOfMonth(date)}</div>`
    + `<div style="font-family:${MONO};font-size:11px;text-transform:uppercase;color:`
    + `${PRIMARY};">${esc(monthShort(date))}</div>`
    + '</div></td>'
    // Details
    + '<td valign="top" style="padding-left:16px;">'
    + `<div style="font-family:${DISPLAY};font-size:18px;line-height:24px;font-weight:700;">`
    + `${link(url, e.title, `color:${INK};text-decoration:none;`)}</div>`
    + `<div style="font-family:${MONO};font-size:12px;line-height:20px;color:${INK_2}`
    + `;padding-top:4px;">${esc(timeRange(e.startTime, e.endTime))}`;
  if (e.location != null && !javaIsBlank(e.location)) sb += ` · ${esc(e.location)}`;
  sb += '</div>';
  if (e.organization != null) {
    sb += `<div style="font-family:${BODY};font-size:14px;color:${INK_2}`
      + `;padding-top:2px;">${esc(e.organization.name)}</div>`;
  }
  sb += '<div style="padding-top:6px;">'
    + link(url, eventCta(e), `font-family:${BODY};font-size:14px;font-weight:600;color:${PRIMARY};text-decoration:none;`)
    + '</div>'
    + '</td></tr></table></td></tr>';
  return sb;
}

// ---------------------------------------------------------------- text

function textBody(input: DigestRenderInput): string {
  const d = input.digest;
  let sb = `LA SEMANA EN ITBA\n${capitalize(input.week.rangeLabel())}\n\n`;
  if (input.intro != null && !javaIsBlank(input.intro)) sb += `${javaStrip(input.intro)}\n\n`;

  sb += 'LO QUE PASÓ\n-----------\n';
  if (d.articles.length === 0) sb += 'Esta semana no hubo artículos nuevos.\n';
  for (const a of d.articles) {
    sb += `\n* ${oneLine(a.title)}\n  ${oneLine(orgLabel(a.organization))}`;
    if (a.publishedAt != null) sb += ` · ${shortDate(a.publishedAt)}`;
    sb += '\n';
    if (a.excerpt != null && !javaIsBlank(a.excerpt)) sb += `  ${oneLine(a.excerpt)}\n`;
    sb += `  ${articleUrl(input.publicBaseUrl, a.id)}\n`;
  }

  const nextWeek = nextWeekEvents(input);
  const later = laterEvents(input);
  sb += '\nLO QUE VIENE\n------------\n';
  if (nextWeek.length === 0) sb += `${NO_EVENTS_NEXT_WEEK}\n`;
  for (const e of nextWeek) sb += textEvent(e, input.publicBaseUrl);
  if (later.length > 0) {
    sb += `\n${NEW_EVENTS.toUpperCase()}\n${NEW_EVENTS_SUBTITLE}\n`;
    for (const e of later) sb += textEvent(e, input.publicBaseUrl);
  }
  if (d.events.length > 0) sb += `\nTodos los eventos: ${input.publicBaseUrl}/events\n`;
  return sb;
}

function textEvent(e: DigestEvent, base: string): string {
  let sb = `\n* ${oneLine(e.title)}\n  ${capitalize(longDate(e.eventDate))} · ${timeRange(e.startTime, e.endTime)}`;
  if (e.location != null && !javaIsBlank(e.location)) sb += ` · ${oneLine(e.location)}`;
  sb += '\n';
  if (e.organization != null) sb += `  ${oneLine(e.organization.name)}\n`;
  sb += `  ${eventUrl(base, e.id)}\n`;
  return sb;
}

// ---------------------------------------------------------------- helpers

const nextWeekEvents = (input: DigestRenderInput) => input.digest.events.filter((e) => !input.week.isLaterEvent(e.eventDate));
const laterEvents = (input: DigestRenderInput) => input.digest.events.filter((e) => input.week.isLaterEvent(e.eventDate));

const eventCta = (e: DigestEvent) => (e.signup ? 'Ver evento e inscribirse →' : 'Ver evento →');
const orgLabel = (org: DigestOrg | null) => (org != null ? org.name : 'Independiente');

function preheader(d: DigestShared): string {
  if (d.articles.length > 0) return oneLine(d.articles[0]!.title);
  if (d.events.length > 0) return `Lo que viene: ${oneLine(d.events[0]!.title)}`;
  return 'Lo que pasó y lo que viene en ITBA';
}

export function articleUrl(base: string, id: string): string {
  return `${base}/articles/${replaceLiteral(javaUrlEncode(id), '+', '%20')}`;
}

export function eventUrl(base: string, id: string): string {
  return `${base}/events/${replaceLiteral(javaUrlEncode(id), '+', '%20')}`;
}

export function isAbsoluteHttpUrl(url: string | null | undefined): boolean {
  if (url == null) return false;
  const u = javaTrim(url).toLowerCase();
  if (!((u.startsWith('https://') || u.startsWith('http://')) && u.length > 8)) return false;
  for (let i = 0; i < u.length; i++) {
    const c = u.charCodeAt(i);
    // u.chars(): UTF-16 units; Character.isWhitespace(int) on a unit.
    if (isJavaWhitespace(c) || c === 0x22 || c === 0x27 || c === 0x3c || c === 0x3e) return false;
  }
  return true;
}

function link(href: string, label: string, style: string): string {
  return `<a href="${attr(href)}" target="_blank" style="${style}">${esc(label)}</a>`;
}

/** Escaped, line breaks kept as <br>. */
export function multiline(s: string): string {
  return replaceLiteral(replaceLiteral(replaceLiteral(esc(javaStrip(s)), '\r\n', '\n'), '\r', '\n'), '\n', '<br>');
}

/** DigestRenderer.esc: & < > " ' (null -> ""). */
export function esc(s: string | null | undefined): string {
  if (s == null) return '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    switch (c) {
      case '&': out += '&amp;'; break;
      case '<': out += '&lt;'; break;
      case '>': out += '&gt;'; break;
      case '"': out += '&quot;'; break;
      case "'": out += '&#39;'; break;
      default: out += c;
    }
  }
  return out;
}

export const attr = esc;

/** s.replaceAll("\\s+", " ").strip() with Java's ASCII \s. */
export function oneLine(s: string | null | undefined): string {
  return s == null ? '' : javaStrip(s.replace(/[ \t\n\x0B\f\r]+/g, ' '));
}

/** LocalTime "HH:mm[:ss[.f]]" -> comparable seconds. */
function timeSeconds(t: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(t);
  if (!m) throw new Error(`Not a LocalTime: ${t}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) + Number(`0.${m[4] ?? '0'}`);
}

/** DateTimeFormatter.ofPattern("HH:mm") */
const hm = (t: string) => t.slice(0, 5);

function timeRange(start: string | null, end: string | null): string {
  if (start == null) return '';
  if (end == null || !(timeSeconds(end) > timeSeconds(start))) return `${hm(start)} hs`;
  return `${hm(start)} a ${hm(end)} hs`;
}

const shortDate = (d: LocalDate) => `${dayOfMonth(d)} ${monthShort(d)}`;
// stripDot(...): the JDK's es-AR short names carry no dot.
const weekdayShort = (d: LocalDate) => ES_DAYS_SHORT[dayOfWeek(d) - 1]!;
const monthShort = (d: LocalDate) => ES_MONTHS_SHORT[monthOf(d) - 1]!;

/** Character.toUpperCase(s.charAt(0)) + s.substring(1). */
export function capitalize(s: string): string {
  return s.length === 0 ? s : javaCharToUpperCase(s[0]!) + s.slice(1);
}

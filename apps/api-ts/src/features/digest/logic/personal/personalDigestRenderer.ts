// Port of apps/api/src/main/java/org/ceitba/api/service/digest/personal/PersonalDigestRenderer.java.
//
// Renders "Tu cuatrimestre" as rows of the digest's 600px table (same palette
// and fonts as DigestRenderer) plus its plain-text form. Every piece of data
// goes through DigestRenderer.esc. The suggester of a correction is never
// known here ("Alguien reportó…").
//
// TODO(digest-service): TuCuatrimestreSection (loader + vote links
// `${publicBaseUrl}/correction?token=${URLEncoder(token)}&vote=confirm|reject`)
// and PersonalDigestLoader are repository code.

import { DAY_NAMES, ES_DAYS_FULL } from '../../../../lib/javaCompat';
import { esc, oneLine, type PersonalSection } from '../digestRenderer';
import type { CorrectionPrompt, CorrectionSlot, PersonalDigest } from './types';

/** The two vote links of one correction prompt. */
export interface VoteLinks { confirm: string; reject: string }

export const TITLE = 'Tu cuatrimestre';
export const CTA = 'Armá tu horario en la app';
export const YES = 'Sí, es así';
export const NO = 'No';
export const UPDATED = 'actualizado esta semana';

const PRIMARY = '#1A3C6E';
const PRIMARY_50 = '#EEF3FA';
const ACCENT = '#F5A623';
const INK = '#1C1C1E';
const INK_2 = '#6B7280';
const BORDER = '#E5E7EB';
const BODY = "'Source Sans 3', Lato, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";

export function renderPersonalDigest(p: PersonalDigest, schedulerUrl: string,
                                     voteLinks: (correctionId: string) => VoteLinks): PersonalSection {
  let html = '<tr><td class="px" style="padding:32px 40px 8px 40px;">'
    + `<div style="font-family:${MONO}`
    + `;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${PRIMARY};">`
    + `${esc(TITLE)}</div>`
    + `<div style="border-bottom:1px solid ${BORDER};padding-bottom:10px;"></div>`
    + '</td></tr>';
  let text = `${TITLE.toUpperCase()}\n${'-'.repeat(TITLE.length)}\n`;

  if (p.state === 'NEEDS_SCHEDULE') {
    const msg = 'Guardá tu horario de este cuatrimestre como principal y acá vas a ver tus materias, '
      + 'sus wikis y los horarios por confirmar.';
    html += row(paragraph(msg) + button(schedulerUrl, CTA, true));
    text += `${msg}\n${CTA}: ${schedulerUrl}\n`;
    return { html, text };
  }

  // Subjects
  let sb = `<div style="font-family:${BODY};font-size:15px;line-height:24px;color:${INK};">`;
  for (const s of p.subjects) {
    sb += `<div style="padding:3px 0;">${esc(s.name)}`;
    if (s.commissionName != null) {
      sb += ` <span style="font-family:${MONO};font-size:12px;color:${INK_2}`
        + `;">· com. ${esc(s.commissionName)}</span>`;
    }
    sb += '</div>';
    text += `* ${oneLine(s.name)}`;
    if (s.commissionName != null) text += ` · com. ${oneLine(s.commissionName)}`;
    text += '\n';
  }
  sb += '</div>';
  html += row(sb);

  // Wiki links
  if (p.wiki.length > 0) {
    let wb = label('Wikis de tus materias');
    text += '\nWikis de tus materias\n';
    for (const w of p.wiki) {
      wb += `<div style="padding:3px 0;font-family:${BODY};font-size:15px;line-height:24px;">`
        + `<a href="${esc(w.url)}" target="_blank" style="color:${PRIMARY}`
        + `;font-weight:600;text-decoration:none;">${esc(w.subjectName)} →</a>`;
      if (w.updatedThisWeek) {
        wb += ` <span style="font-family:${MONO};font-size:11px;letter-spacing:1px;`
          + `text-transform:uppercase;color:${INK};background:${ACCENT}`
          + `;border-radius:2px;padding:1px 6px;">${esc(UPDATED)}</span>`;
      }
      wb += '</div>';
      text += `* ${oneLine(w.subjectName)}`;
      if (w.updatedThisWeek) text += ` (${UPDATED})`;
      text += `: ${w.url}\n`;
    }
    html += row(wb);
  }

  // Corrections to confirm
  if (p.corrections.length > 0) {
    text += '\nHorarios por confirmar\n';
    let cb = label('Horarios por confirmar');
    for (const c of p.corrections) {
      const s = sentence(c);
      const links = voteLinks(c.correctionId);
      cb += `<div style="background:${PRIMARY_50};border-radius:3px;padding:14px 16px;margin:8px 0;">`
        + paragraph(s)
        + '<div style="padding-top:4px;">'
        + button(links.confirm, YES, true)
        + '<span style="display:inline-block;width:8px;"></span>'
        + button(links.reject, NO, false)
        + '</div></div>';
      text += `* ${s}\n  ${YES}: ${links.confirm}\n  ${NO}: ${links.reject}\n`;
    }
    cb += `<div style="font-family:${BODY};font-size:13px;line-height:20px;color:${INK_2}`
      + ';padding-top:4px;">Tu respuesta es anónima. Con 3 confirmaciones el horario corregido se usa en el combinador.</div>';
    text += 'Tu respuesta es anónima. Con 3 confirmaciones el horario corregido se usa en el combinador.\n';
    html += row(cb);
  }
  return { html, text };
}

/**
 * "Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 en vez
 * de lunes 08:00 a 11:00. ¿Es así?"
 */
export function sentence(c: CorrectionPrompt): string {
  const sga = c.sga.length === 0 ? 'lo que figura en el SGA (sin horarios)' : slots(c.sga);
  return `Alguien reportó que ${oneLine(c.subjectName)} (com. ${oneLine(c.commissionName)}`
    + `) se dicta ${slots(c.proposed)} en vez de ${sga}. ¿Es así?`;
}

export function slots(list: readonly CorrectionSlot[]): string {
  const parts = list.map(slot);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function slot(s: CorrectionSlot): string {
  // DayOfWeek.valueOf(day) (exact constant name), else the raw value.
  const i = (DAY_NAMES as readonly string[]).indexOf(s.day);
  const day = i >= 0 ? ES_DAYS_FULL[i]! : s.day;
  return `${day} ${s.from} a ${s.to}`;
}

const row = (inner: string) => `<tr><td class="px" style="padding:8px 40px;">${inner}</td></tr>`;

const label = (s: string) => `<div style="font-family:${BODY};font-size:14px;font-weight:600;color:${INK_2}`
  + `;padding:4px 0 2px 0;">${esc(s)}</div>`;

const paragraph = (s: string) => `<p style="margin:0 0 10px 0;font-family:${BODY};font-size:15px;line-height:24px;color:${INK}`
  + `;">${esc(s)}</p>`;

function button(href: string, text: string, primary: boolean): string {
  const bg = primary ? PRIMARY : '#FFFFFF';
  const fg = primary ? '#FFFFFF' : PRIMARY;
  return `<a href="${esc(href)}" target="_blank" style="display:inline-block;font-family:${BODY}`
    + `;font-size:14px;font-weight:600;color:${fg};background:${bg};border:1px solid ${PRIMARY}`
    + `;border-radius:3px;padding:8px 16px;text-decoration:none;">${esc(text)}</a>`;
}

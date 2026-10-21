// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbStyleChecks.java.
//
// Deterministic quality checks of a page body that need no database (see
// docs/SUBJECT-WIKI.md "Quality checks"). Each error starts with its reject
// reason ("latex_format:", "meta_section:", "self_link:"), which is also what
// the retry prompt and the eval's rejectReasons key on. Code is ignored.

import { DOT, S, jSplit, jStrip, lowerRoot } from './javaString';
import { stripCode, type Parsed } from './kbWikilinks';

export const LATEX_FORMAT = 'latex_format';
export const META_SECTION = 'meta_section';
export const SELF_LINK = 'self_link';

// Backslash commands that only make sense as math (the SPA renders math with KaTeX
// only inside $...$ / $$...$$).
const COMMANDS =
  'bar|hat|overline|underline|vec|frac|dfrac|tfrac|sum|prod|int|lim|sqrt|binom' +
  '|pm|mp|cdot|cdots|ldots|times|div|leq|geq|neq|approx|equiv|infty|partial|nabla|sim' +
  '|mu|sigma|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|pi|rho|tau|phi|varphi|chi|psi|omega|eta' +
  '|kappa|nu|xi|zeta|Delta|Sigma|Omega|Gamma|Theta|Lambda|Pi|Phi|Psi' +
  '|text|mathbb|mathrm|mathbf|left|right|begin|end|rightarrow|Rightarrow|leftarrow|Leftarrow';
const BARE_COMMAND = new RegExp(`\\\\(?:${COMMANDS})(?![A-Za-z])`);
const DOUBLED_IN_PROSE = /\\\\[A-Za-z]/;
const DOUBLED_COMMAND = new RegExp(`\\\\\\\\(?:${COMMANDS})(?![A-Za-z])`);
// Pattern.MULTILINE; Java's `$` also stops before U+0085 (JS's does not).
const LINE_END_BACKSLASH = /(?<!\\)\\[ \t]*$/m;

/**
 * The text with math spans blanked out (line structure kept) and the count of
 * unbalanced `$` delimiters. A span is $$...$$ (may cross lines) or $...$ (one paragraph).
 */
export interface MathSplit {
  prose: string;
  spans: string[];
  unbalanced: number;
}

export function splitMath(text: string): MathSplit {
  let prose = '';
  const spans: string[] = [];
  let unbalanced = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\\' && i + 1 < n && text[i + 1] === '$') {
      // escaped dollar: a literal
      prose += '  ';
      i += 2;
      continue;
    }
    if (c !== '$') {
      prose += c;
      i++;
      continue;
    }
    const block = i + 1 < n && text[i + 1] === '$';
    const delim = block ? '$$' : '$';
    const from = i + delim.length;
    let close = from;
    while (true) {
      close = text.indexOf(delim, close);
      if (close < 0) break;
      if (text[close - 1] === '\\') {
        close++;
        continue;
      }
      break;
    }
    const blank = text.indexOf('\n\n', from);
    if (close < 0 || (!block && blank >= 0 && blank < close) || close === from) {
      unbalanced++;
      prose += ' ';
      i += delim.length;
      continue;
    }
    spans.push(text.substring(from, close));
    for (let k = i; k < close + delim.length; k++) prose += text[k] === '\n' ? '\n' : ' ';
    i = close + delim.length;
  }
  return { prose, spans, unbalanced };
}

export function latexErrors(body: string): string[] {
  const out: string[] = [];
  const m = splitMath(stripCode(body));
  if (m.unbalanced > 0) {
    out.push(
      `${LATEX_FORMAT}: unbalanced $ delimiters (${m.unbalanced} unmatched); every formula ` +
        'goes between $...$ (or $$...$$), on one paragraph; write a literal dollar or a price as \\$ (e.g. \\$2.000)',
    );
  }
  const bare = BARE_COMMAND.exec(m.prose);
  if (bare) {
    out.push(`${LATEX_FORMAT}: math command '${bare[0]}' outside $...$; put the whole formula between $ delimiters`);
  }
  const doubled = DOUBLED_IN_PROSE.exec(m.prose);
  if (doubled) {
    out.push(
      `${LATEX_FORMAT}: doubled backslash '${doubled[0]}' in the text; use a single backslash and only inside $...$`,
    );
  }
  if (LINE_END_BACKSLASH.test(m.prose)) {
    out.push(`${LATEX_FORMAT}: line ends with a stray backslash; a formula must not be split across lines`);
  }
  for (const span of m.spans) {
    if (LINE_END_BACKSLASH.test(span)) {
      out.push(`${LATEX_FORMAT}: a formula has a stray backslash at the end of a line; write each formula on one line`);
      break;
    }
  }
  for (const span of m.spans) {
    const d = DOUBLED_COMMAND.exec(span);
    if (d) {
      out.push(`${LATEX_FORMAT}: doubled backslash '${d[0]}' inside a formula; use '${d[0].substring(1)}'`);
      break;
    }
  }
  return out;
}

// ---- meta sections: notes to the editor, not content ----

const HEADING = new RegExp(`^#{1,6}${S}+(${DOT}*?)${S}*#*${S}*$`);
const BULLET = new RegExp(`^${S}*(?:[-*+]|\\d+[.)])${S}+(${DOT}*)$`);
const HEADING_META = new RegExp(
  `^(?:que falta\\b${DOT}*|por completar\\b${DOT}*|a completar\\b${DOT}*|por hacer|pendientes?|fixme\\b${DOT}*)$`,
);
const LINE_META = new RegExp(
  `^\\W*(?:(?:por completar|a completar)\\b${DOT}*` +
    `|agregar (?:enlaces|links|vinculos|paginas|referencias|secciones)\\b${DOT}*` +
    `|pendiente${S}*[:\\-]${S}*(?:agregar|completar|revisar|anadir|incluir|falta|ampliar|documentar)${DOT}*)$`,
);
// Case-sensitive: "todo" means "all" in Spanish.
const MARKER = /^\W*(?:TODO|FIXME)\b|\[(?:TODO|FIXME)\b|\bTODO:/;

export function metaSectionErrors(body: string): string[] {
  const out: string[] = [];
  for (const raw of jSplit(stripCode(body), '\n', -1)) {
    const line = jStrip(raw);
    if (line.length === 0) continue;
    const h = HEADING.exec(line);
    if (h) {
      const text = jStrip(h[1]!.replaceAll('*', '').replaceAll('_', ''));
      if (HEADING_META.test(fold(text)) || text === 'TODO') {
        out.push(`${META_SECTION}: heading '${text}' is a note to the editor, not content; remove the section`);
      }
      continue;
    }
    const b = BULLET.exec(line);
    const text = jStrip((b ? b[1]! : line).replaceAll('*', ''));
    if (MARKER.test(text) || LINE_META.test(fold(text))) {
      out.push(`${META_SECTION}: '${preview(text)}' is a note to the editor, not content; remove it`);
    }
  }
  return out.length > 3 ? out.slice(0, 3) : out;
}

// ---- self links ----

/** A link to the page's own slug without an anchor ([[slug#section]] and [[#section]] are fine). */
export function selfLinkErrors(links: Parsed, subjectId: string, slug: string | null): string[] {
  const out: string[] = [];
  if (slug == null) return out;
  for (const l of links.links) {
    if (l.anchor == null && l.subjectId === subjectId && l.slug === slug) {
      out.push(
        `${SELF_LINK}: the page links to itself with [[${l.raw}]]; remove the link (links ` +
          'to a heading of the same page, [[#heading]], are fine)',
      );
    }
  }
  return out;
}

function fold(s: string): string {
  return lowerRoot(s.normalize('NFD').replace(/\p{M}+/gu, ''));
}

function preview(s: string): string {
  return s.length <= 80 ? s : s.substring(0, 77) + '...';
}

// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbWikilinks.java.
//
// Wikilinks of a page body (docs/SUBJECT-WIKI.md):
//   [[slug]] / [[slug|text]]                  page in the same subject
//   [[61.12/slug]] / [[61.12/slug|text]]      page in another subject
//   [[61.12]] / [[61.12|text]]                another subject's index
//   [[file:<uuid>]] / [[file:<uuid>|text]]    citation of a source file
// Page links may end in #anchor ([[slug#a]], [[61.12/slug#a]], [[#a]] for
// the same page); the anchor is a folded `##`-`####` heading (anchor()).
// Links inside fenced code blocks and inline code are ignored.

import { DOT, S, lowerRoot } from './javaString';
import { parseUuid, type Uuid } from './uuid';
import { javaTrim, javaSplit } from '../../../lib/javaCompat';

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Subject ids are codes like "61.12" (letters allowed after the digits).
export const SUBJECT_ID = /^[0-9]{1,3}(\.[0-9A-Za-z]{1,4})+$/;

const LINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]/g;
// (?ms)^(```|~~~).*?(^\1[ \t]*$|\z): Java matches by code point, hence `u`.
const FENCE = /^(```|~~~)[\s\S]*?(^\1[ \t]*$|$(?![\s\S]))/gmu;
const INLINE_CODE = /`[^`\n]*`/g;
const HEADING = new RegExp(`^#{2,4}(?!#)${S}+(${DOT}*?)${S}*#*${S}*$`);

/** A link to a page: raw = the inner text before '|' (trimmed), anchor included; anchor = the folded #anchor or null. */
export interface PageLink {
  raw: string;
  subjectId: string;
  slug: string;
  anchor: string | null;
}

/** A [[file:...]] citation; id is null when it is not a UUID. */
export interface Citation {
  raw: string;
  id: Uuid | null;
}

export interface Parsed {
  links: PageLink[];
  citations: Citation[];
}

/** currentSlug: target of same-page links ([[#anchor]]). */
export function parse(body: string, currentSubjectId: string, currentSlug: string | null = null): Parsed {
  const text = stripCode(body);
  const links = new Map<string, PageLink>();
  const citations: Citation[] = [];
  for (const m of text.matchAll(LINK)) {
    const raw = javaTrim(m[1]!);
    if (raw.length === 0) continue;
    if (raw.startsWith('file:')) {
      citations.push({ raw, id: parseUuid(javaTrim(raw.substring(5))) });
      continue;
    }
    if (!links.has(raw)) links.set(raw, target(raw, currentSubjectId, currentSlug));
  }
  return { links: [...links.values()], citations };
}

export function target(raw: string, currentSubjectId: string, currentSlug: string | null): PageLink {
  let anchorText: string | null = null;
  let tgt = raw;
  const hash = raw.indexOf('#');
  if (hash >= 0) {
    anchorText = anchor(raw.substring(hash + 1));
    if (anchorText.length === 0) anchorText = null;
    tgt = javaTrim(raw.substring(0, hash));
  }
  if (tgt.length === 0) {
    return { raw, subjectId: currentSubjectId, slug: currentSlug == null ? 'index' : currentSlug, anchor: anchorText };
  }
  const slash = tgt.indexOf('/');
  if (slash > 0) {
    return { raw, subjectId: javaTrim(tgt.substring(0, slash)), slug: javaTrim(tgt.substring(slash + 1)), anchor: anchorText };
  }
  if (SUBJECT_ID.test(tgt)) return { raw, subjectId: tgt, slug: 'index', anchor: anchorText };
  return { raw, subjectId: currentSubjectId, slug: tgt, anchor: anchorText };
}

/**
 * "Cómo se calcula" -> "como-se-calcula": lowercase, accents removed,
 * runs of anything but [a-z0-9] -> '-', trimmed of '-'.
 */
export function anchor(text: string): string {
  const n = text.normalize('NFD').replace(/\p{M}+/gu, '');
  return lowerRoot(n).replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/g, '');
}

/** Anchors of a body's ## to #### headings (wikilinks in them count by text). */
export function headingAnchors(body: string): Set<string> {
  const out = new Set<string>();
  for (const line of javaSplit(stripCode(body), /\n/, -1)) {
    const m = HEADING.exec(line);
    if (!m) continue;
    out.add(headingAnchor(m[1]!));
  }
  return out;
}

/** The anchor of a heading's text (wikilinks in it count by their text). */
export function headingAnchor(headingText: string): string {
  return anchor(
    headingText
      .replace(/\[\[[^[\]|\n]+\|([^[\]\n]*)\]\]/g, (_m, t: string) => t)
      .replace(/\[\[([^[\]\n]+)\]\]/g, (_m, t: string) => t),
  );
}

/** Body with code blocks/spans blanked out (line structure kept). */
export function stripCode(body: string): string {
  const noFences = body.replace(FENCE, (g) => g.replace(/[^\n]/gu, ' '));
  return noFences.replace(INLINE_CODE, (g) => ' '.repeat(g.length));
}

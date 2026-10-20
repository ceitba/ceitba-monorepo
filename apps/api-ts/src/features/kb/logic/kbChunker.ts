// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbChunker.java.
//
// Cuts a wiki page into the chunks that get embedded (docs/SUBJECT-WIKI.md
// "Embeddings"): chunk 0 = title, summary and the text before the first ##
// heading; then one chunk per ## section, its ### subsections included.
// Sections longer than MAX_CHARS are split at blank lines (or hard-cut when a
// single paragraph is longer). Every chunk carries a title (the page title, plus
// its heading), so it still says what it is about out of context; the embedding
// service puts title and body into the model's document prompt. Wikilinks become
// their text ([[slug|text]] -> text, [[slug]] -> slug); bare citations
// ([[file:<uuid>]]) are dropped. Headings inside code fences don't split.

import { DOT, S, jSplit, jStrip, jTrim } from './javaString';
import { headingAnchor, stripCode } from './kbWikilinks';

// ~1.5k tokens of Spanish prose: well inside the embedding model's input
// window, small enough that one chunk is about one thing.
export const MAX_CHARS = 6000;
// A chunk title longer than this is cut, so a section always has room.
export const MAX_TITLE = 500;
// kb_page_chunk.anchor is VARCHAR(256).
export const MAX_ANCHOR = 256;

const H2 = new RegExp(`^##(?!#)${S}+(${DOT}*?)${S}*#*${S}*$`);
const LINK_WITH_TEXT = /\[\[[^[\]|\n]+\|([^[\]\n]*)\]\]/g;
const BARE_CITATION = new RegExp(`\\[\\[${S}*file:[^[\\]\\n]*\\]\\]`, 'g');
const BARE_LINK = /\[\[([^[\]\n]+)\]\]/g;

/**
 * heading/anchor are null for chunk 0. title = "Page" (chunk 0) or
 * "Page — Heading"; body = chunk 0's summary and intro, or the section text.
 */
export class Chunk {
  constructor(
    readonly ordinal: number,
    readonly heading: string | null,
    readonly anchor: string | null,
    readonly title: string,
    readonly body: string,
  ) {}

  /** What is stored (kb_page_chunk.content) and shown for a hit. */
  text(): string {
    return this.body.length === 0 ? this.title : this.title + '\n\n' + this.body;
  }
}

export function chunk(title: string, summary: string, markdown: string): Chunk[] {
  const lines = jSplit(markdown, '\n', -1);
  // Same line structure, code blanked out: headings are looked for here.
  const plain = jSplit(stripCode(markdown), '\n', -1);

  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let anchor: string | null = null;
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const m = i < plain.length ? H2.exec(plain[i]!) : null;
    if (m) {
      add(chunks, title, summary, heading, anchor, section);
      heading = jTrim(linkText(m[1]!));
      // Same anchor as the import validator and wikilinks (citations count by their text there).
      anchor = cut(headingAnchor(m[1]!), MAX_ANCHOR);
      section = '';
      continue;
    }
    section += lines[i] + '\n';
  }
  add(chunks, title, summary, heading, anchor, section);
  return chunks;
}

function add(out: Chunk[], title: string, summary: string, heading: string | null, anchor: string | null, body: string): void {
  let text = jStrip(linkText(body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'));
  // Chunk 0 always exists (title and summary alone are worth a vector);
  // an empty ## section adds nothing.
  if (heading != null && text.length === 0) return;
  const chunkTitle = cut(heading == null ? title : title + ' — ' + heading, MAX_TITLE);
  if (heading == null) text = text.length === 0 ? summary : summary + '\n\n' + text;
  for (const part of split(text, MAX_CHARS - chunkTitle.length - 2)) {
    out.push(new Chunk(out.length, heading, anchor, chunkTitle, part));
  }
}

function cut(s: string, max: number): string {
  return s.length <= max ? s : s.substring(0, max);
}

/** Wikilinks reduced to their text; bare citations dropped. */
export function linkText(s: string): string {
  let t = s.replace(LINK_WITH_TEXT, (_m, g1: string) => g1);
  t = t.replace(BARE_CITATION, '');
  return t.replace(BARE_LINK, (_m, g1: string) => jTrim(g1));
}

/** Greedy packing of paragraphs into parts of at most max chars. */
export function split(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let cur = '';
  for (let para of jSplit(text, /\n\n/)) {
    while (para.length > max) {
      if (cur.length > 0) {
        parts.push(cur);
        cur = '';
      }
      parts.push(para.substring(0, max));
      para = para.substring(max);
    }
    if (cur.length > 0 && cur.length + 2 + para.length > max) {
      parts.push(cur);
      cur = '';
    }
    if (cur.length > 0) cur += '\n\n';
    cur += para;
  }
  if (cur.length > 0) parts.push(cur);
  return parts;
}

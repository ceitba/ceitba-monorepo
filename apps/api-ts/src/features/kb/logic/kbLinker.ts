// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbLinker.java.
//
// Deterministic linker (port of scripts/kb/link_kb.py). Rule: a key concept
// that has its own page in the subject is never mentioned without a link to
// it. In every `##` section of a page (and the intro before the first one),
// the first plain-text mention of another page of the same subject (its
// title or an alias) becomes [[slug|mention]], unless the section already
// links to that page. Headings, code, math, existing links and Markdown
// links are never touched. Cross-subject mentions are left alone (string
// matching across subjects produces false friends).
//
// link() rewrites a body; unlinked() lists what link() would add (the
// import/pipeline coverage check: "no unlinked mention of a same-subject page").

import { charToLowerCase, isLetterOrDigitChar, jSplit, jSplit2, jStrip, jTrim } from './javaString';

// DOTALL: `.` -> [\s\S].
const PROTECT = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|`[^`]*`|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))/g;
const WIKILINK = /\[\[([^\]]+)\]\]/g;
const WORD = /[\p{L}\p{N}_]+/gu;
const SYMBOLS = /[=+$()]/;
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'a', 'por', 'para', 'con', 'un', 'una', 'o']);

/** A page of the subject as the linker sees it. */
export interface Target {
  slug: string | null;
  title: string | null;
  aliases: (string | null)[] | null;
}

export interface Mention {
  slug: string;
  text: string;
}

export interface Result {
  body: string;
  addedSlugs: string[];
}

export function link(body: string, currentSlug: string | null, pages: Target[]): Result {
  return run(body, currentSlug, pages, false, []);
}

export function unlinked(body: string, currentSlug: string | null, pages: Target[]): Mention[] {
  const out: Mention[] = [];
  run(body, currentSlug, pages, true, out);
  return out;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function run(body: string, currentSlug: string | null, pages: Target[], check: boolean, found: Mention[]): Result {
  const lines = jSplit(body, '\n', -1);
  const sections: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ') && cur.length > 0) {
      sections.push(cur);
      cur = [];
    }
    cur.push(i);
  }
  sections.push(cur);
  let inFence = false;
  const fenced: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const t = jTrim(lines[i]!);
    if (t.startsWith('```') || t.startsWith('~~~')) {
      fenced[i] = true;
      inFence = !inFence;
    } else {
      fenced[i] = inFence;
    }
  }

  // Comparator.comparing(Target::slug): String.compareTo, stable.
  const targets = pages
    .filter((p) => p.slug != null && p.slug !== currentSlug && p.slug !== 'index')
    .slice()
    .sort((a, b) => compareStrings(a.slug!, b.slug!));
  const added: string[] = [];
  for (const idxs of sections) {
    const linked = new Set<string>();
    for (const i of idxs) {
      for (const m of lines[i]!.matchAll(WIKILINK)) {
        linked.add(jTrim(jSplit2(jSplit2(m[1]!, '|')[0]!, '#')[0]!));
      }
    }
    for (const t of targets) {
      const ts = terms(t);
      const slug = t.slug!;
      if (linked.has(slug) || ts.length === 0) continue;
      for (const i of idxs) {
        const line = lines[i]!;
        if (fenced[i] || line.startsWith('#') || line.startsWith('---')) continue;
        const replaced = replaceFirst(line, ts, slug, check, found);
        if (replaced != null) {
          if (!check) {
            lines[i] = replaced;
            added.push(slug);
          }
          linked.add(slug);
          break;
        }
      }
    }
  }
  return { body: lines.join('\n'), addedSlugs: added };
}

/** The line with its first mention of one of `terms` linked, or null. */
function replaceFirst(line: string, terms: string[], slug: string, check: boolean, found: Mention[]): string | null {
  let last = 0;
  const segments: [number, number][] = []; // plain-text ranges
  for (const m of line.matchAll(PROTECT)) {
    segments.push([last, m.index]);
    last = m.index + m[0].length;
  }
  segments.push([last, line.length]);
  const folded = fold(line);
  for (const [from, to] of segments) {
    const plain = folded.substring(from, to);
    for (const term of terms) {
      const at = find(plain, fold(term));
      if (at < 0) continue;
      const start = from + at;
      const end = start + term.length;
      const original = line.substring(start, end);
      if (check) {
        found.push({ slug, text: original });
        return line;
      }
      return line.substring(0, start) + '[[' + slug + '|' + original + ']]' + line.substring(end);
    }
  }
  return null;
}

/** Whole-word occurrence of `term` in `text` (both folded). */
function find(text: string, term: string): number {
  let from = 0;
  while (true) {
    const at = text.indexOf(term, from);
    if (at < 0) return -1;
    const before = at === 0 || !isWord(text[at - 1]!);
    const end = at + term.length;
    const after = end >= text.length || !isWord(text[end]!);
    if (before && after) return at;
    from = at + 1;
  }
}

function isWord(c: string): boolean {
  return isLetterOrDigitChar(c) || c === '_';
}

/**
 * Titles/aliases worth linking, longest first: 2+ content words, or one
 * content word of 4+ letters (title) / 6+ (alias); nothing with symbols.
 */
export function terms(page: Target): string[] {
  const all: (string | null)[] = [page.title];
  if (page.aliases != null) all.push(...page.aliases);
  const out = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    const t = all[i] == null ? '' : jStrip(all[i]!);
    if (t.length === 0 || SYMBOLS.test(t)) continue;
    const ws = contentWords(t);
    const min = i === 0 ? 4 : 6;
    if (ws.length >= 2 || (ws.length === 1 && ws[0]!.length >= min)) out.add(t);
  }
  // Comparator.comparingInt(String::length).reversed(): stable, longest first.
  return [...out].sort((a, b) => b.length - a.length);
}

function contentWords(t: string): string[] {
  const out: string[] = [];
  for (const m of fold(t).matchAll(WORD)) if (!STOP.has(m[0])) out.push(m[0]);
  return out;
}

/**
 * Lowercase without accents, same length as the input (char by char), so
 * positions in the folded text are positions in the original.
 */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const n = c.normalize('NFD');
    const base = n.length === 0 ? c : n[0]!;
    out += charToLowerCase(base);
  }
  return out;
}

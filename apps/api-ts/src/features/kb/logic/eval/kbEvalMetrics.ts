// Port of apps/api/src/main/java/org/ceitba/api/service/kb/eval/KbEvalMetrics.java.
//
// Automatic metrics of an evaluation (docs/SUBJECT-WIKI-ADMIN.md §4), pure so
// they can be tested on fixtures. One PageInput per page a configuration
// wrote: its first-pass draft and errors (after the deterministic linker),
// the unlinked mentions found before the linker, and the final version after
// one retry. Doubles are JDouble (Jackson writes 0.5 / 0.0), BigDecimals Dec.

import { Dec } from '../decimal';
import { jSplit, jStrip, lowerRoot, S, upperRoot } from '../javaString';
import { JDouble, type JsonObject } from '../jsonNode';
import { sectionsWithoutCitationCount } from '../kbPageParser';
import { parse as parseLinks, stripCode } from '../kbWikilinks';
import { split as splitFile } from '../pipeline/kbPageFiles';

const H2 = new RegExp(`^##(?!#)${S}+`, 'gm');
const CITATION = /\[\[file:/g;
const SENTENCE_SPLIT = new RegExp(`(?<=[.!?])${S}+|\\n+`);
const NUMBER = /(?<![\p{L}0-9])[0-9]+(?:[.,][0-9]+)?/gu;
const MATH = /\$[^$\n]+\$/g;
const MATH_TOKEN = /[A-Za-z]{2,}/g;
const WORD = /[\p{L}][\p{L}\p{N}'-]*/gu;
const LINK_WITH_TEXT = /\[\[[^[\]|\n]+\|([^[\]\n]*)\]\]/g;
const LINK = /\[\[[^[\]\n]+\]\]/g;
const UPPER = /^\p{Uppercase}$/u;
const LETTER = /^\p{L}$/u;

export class PageInput {
  constructor(
    readonly slug: string,
    readonly firstContent: string | null,
    readonly firstErrors: string[],
    readonly coverageBeforeLinker: number,
    readonly finalContent: string | null,
    readonly finalErrors: string[],
    readonly sourceText: string | null,
  ) {}

  written(): boolean {
    return this.firstContent != null;
  }

  firstValid(): boolean {
    return this.written() && this.firstErrors.length === 0;
  }

  finalValid(): boolean {
    return (this.finalContent != null || this.firstContent != null) && this.finalErrors.length === 0;
  }
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: Dec;
  requests: number;
  emptyToolCalls: number;
}

const count = (re: RegExp, s: string): number => [...s.matchAll(re)].length;

export function compute(pages: PageInput[], pagesPlanned: number, usage: Usage, durationSec: number | null): JsonObject {
  let written = 0;
  let firstValid = 0;
  let finalValid = 0;
  let sections = 0;
  let citations = 0;
  let uncited = 0;
  let coverage = 0;
  let copies = 0;
  let words = 0;
  let finals = 0;
  let crossLinks = 0;
  let anchors = 0;
  let checkable = 0;
  let unsupported = 0;
  const reasons = new Map<string, number>();
  const bump = (k: string) => reasons.set(k, (reasons.get(k) ?? 0) + 1);
  for (const p of pages) {
    if (!p.written()) {
      bump(category(p.firstErrors.length === 0 ? 'no answer' : p.firstErrors[0]!));
      continue;
    }
    written++;
    if (p.firstValid()) firstValid++;
    if (p.finalValid()) finalValid++;
    const firstBody = splitFile(p.firstContent).body;
    sections += count(H2, firstBody);
    citations += count(CITATION, firstBody);
    uncited += sectionsWithoutCitationCount(firstBody);
    coverage += p.coverageBeforeLinker;
    let copied = false;
    for (const e of p.firstErrors) {
      bump(category(e));
      if (e.startsWith('copies')) copied = true;
    }
    if (copied) copies++;
    const fin = p.finalContent != null ? p.finalContent : p.firstContent;
    const body = splitFile(fin).body;
    finals++;
    words += count(WORD, stripLinks(body));
    for (const l of parseLinks(body, 'this', p.slug).links) {
      if (l.subjectId !== 'this') crossLinks++;
      if (l.anchor != null) anchors++;
    }
    const g = grounding(body, p.sourceText);
    checkable += g[0];
    unsupported += g[1];
  }
  const rr: JsonObject = {};
  for (const k of [...reasons.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) rr[k] = reasons.get(k)!;
  return {
    pagesPlanned,
    pagesWritten: written,
    validPages: finalValid,
    firstPassValidRate: new JDouble(rate(firstValid, written)),
    finalValidRate: new JDouble(rate(finalValid, written)),
    rejectReasons: rr,
    citationDensity: new JDouble(sections === 0 ? 0 : round(citations / sections)),
    uncitedSections: uncited,
    coverageViolations: coverage,
    copyViolations: copies,
    unsupportedClaimsRate: new JDouble(rate(unsupported, checkable)),
    claimsChecked: checkable,
    groundingIsHeuristic: true,
    avgWords: finals === 0 ? 0 : Math.round(words / finals),
    crossLinks,
    anchors,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd.setScale(4, 'HALF_UP'),
    costPerValidPage: finalValid === 0 ? null : usage.costUsd.divide(Dec.fromInt(finalValid), 4, 'HALF_UP'),
    emptyToolCallRate: new JDouble(rate(usage.emptyToolCalls, usage.requests)),
    durationSec: durationSec == null ? null : durationSec,
  };
}

/**
 * Deterministic grounding heuristic: every sentence with a number, a formula or a
 * proper noun needs at least one of those anchors to appear in the cited sources'
 * text or digests. Returns [checkable, unsupported].
 */
export function grounding(body: string, sourceText: string | null): [number, number] {
  const source = fold(sourceText == null ? '' : sourceText);
  let checkable = 0;
  let unsupported = 0;
  let text = stripCode(body).replace(/\[\[file:[^\]]*\]\]/g, ' ');
  text = text.replace(LINK_WITH_TEXT, (_m, t: string) => t).replace(LINK, ' ');
  for (const raw of jSplit(text, SENTENCE_SPLIT)) {
    const sentence = jStrip(raw).replace(new RegExp(`^(#+|[-*+]|[0-9]+[.)])${S}+`), '');
    if (sentence.length === 0 || sentence.startsWith('|')) continue;
    const anchorsSet = new Set<string>();
    for (const n of sentence.matchAll(NUMBER)) anchorsSet.add(n[0].replaceAll(',', '.'));
    let formula = false;
    for (const math of sentence.matchAll(MATH)) {
      formula = true;
      for (const t of math[0].matchAll(MATH_TOKEN)) anchorsSet.add(t[0]);
    }
    if (!formula && sentence.includes('=')) formula = true;
    let first = true;
    for (const w of sentence.matchAll(WORD)) {
      const word = w[0];
      const start = w.index;
      const afterColon = start > 1 && sentence[start - 2] === ':';
      if (!first && !afterColon && word.length >= 3 && UPPER.test(word[0]!) && word !== upperRoot(word)) {
        anchorsSet.add(word);
      } else if (!first && word.length >= 2 && word === upperRoot(word) && [...word.split('')].every((c) => LETTER.test(c))) {
        anchorsSet.add(word); // acronyms: VAN, TIR
      }
      first = false;
    }
    if (anchorsSet.size === 0 && !formula) continue;
    checkable++;
    const supported = [...anchorsSet].some((a) => source.includes(fold(a)));
    if (!supported) unsupported++;
  }
  return [checkable, unsupported];
}

/** A validator error -> its category. */
export function category(error: string | null): string {
  if (error == null) return 'other';
  if (error.startsWith('no answer')) return 'no_answer';
  for (const r of ['latex_format', 'meta_section', 'self_link', 'missing_formula']) if (error.startsWith(r + ':')) return r;
  if (error.includes('has no [[file:')) return 'uncited_section';
  if (error.startsWith('copies')) return 'copy';
  if (error.startsWith('unlinked mention')) return 'unlinked_mention';
  if (error.includes('no heading')) return 'anchor';
  if (error.startsWith('source ') || error.startsWith('cites file')) return 'source';
  if (error.startsWith('citation ') || error.startsWith('invalid citation')) return 'citation_format';
  if (
    error.startsWith('frontmatter') ||
    error.includes('slug') ||
    error.includes('type: index') ||
    error.includes('missing frontmatter') ||
    error.startsWith('empty')
  ) {
    return 'frontmatter';
  }
  return 'other';
}

function stripLinks(body: string): string {
  return body.replace(LINK_WITH_TEXT, (_m, t: string) => t).replace(LINK, ' ');
}

export function fold(s: string): string {
  return lowerRoot(s.normalize('NFD').replace(/\p{M}+/gu, ''));
}

function rate(a: number, b: number): number {
  return b === 0 ? 0 : round(a / b);
}

function round(v: number): number {
  return javaRound(v * 10000) / 10000.0;
}

/** Math.round(double): floor(x + 0.5) (JS's Math.round is the same for finite doubles). */
const javaRound = (x: number): number => Math.round(x);

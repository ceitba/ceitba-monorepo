// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbMustCover.java.
//
// The plan's `mustCover` list of a page: what the page must present (definitions,
// methods, formulas). Never a reason to drop a plan op: bad input becomes [].

import { jStrip } from './javaString';
import { elements, isArray, type JsonValue, type Node } from './jsonNode';
import { splitMath } from './kbStyleChecks';
import { stripCode } from './kbWikilinks';

export const MISSING_FORMULA = 'missing_formula';
export const MAX_ITEMS = 10;
export const MAX_CHARS = 300;

// A backslash command, or ^ / _ followed by a brace: the item is a formula.
const LATEX = /\\[A-Za-z]+|[\^_]\{/;

/** The trimmed, non-blank strings of `node` (max 10, each cut to 300 chars), as a JSON array. */
export function normalize(node: Node): JsonValue[] {
  const out: JsonValue[] = [];
  if (node == null || !isArray(node)) return out;
  for (const n of elements(node)) {
    if (typeof n !== 'string') continue;
    const s = jStrip(n);
    if (s.length === 0) continue;
    out.push(s.length > MAX_CHARS ? s.substring(0, MAX_CHARS) : s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** The reject reason when the plan required formulas and the body has no $ math at all. */
export function missingFormulaErrors(mustCover: Node, body: string | null): string[] {
  const out: string[] = [];
  if (mustCover == null || !isArray(mustCover)) return out;
  let first: string | null = null;
  for (const n of elements(mustCover)) {
    if (typeof n === 'string' && LATEX.test(n)) {
      first = jStrip(n);
      break;
    }
  }
  if (first == null) return out;
  if (splitMath(stripCode(body == null ? '' : body)).spans.length > 0) return out;
  const preview = first.length <= 80 ? first : first.substring(0, 77) + '...';
  out.push(`${MISSING_FORMULA}: the plan required formulas (${preview}) but the page has none`);
  return out;
}

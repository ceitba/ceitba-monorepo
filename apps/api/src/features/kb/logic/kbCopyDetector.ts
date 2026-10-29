// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbCopyDetector.java.
//
// "Never more than 40 consecutive words copied from a source": a page is
// rejected when any run of WINDOW consecutive words of its body also appears
// in a source's extracted text. Both sides are normalized (lowercase,
// accents kept, wikilink syntax and punctuation/Markdown dropped, whitespace
// collapsed) so formatting cannot hide a copy. Runs are compared as 64-bit
// hashes of their word sequence (the same 64-bit values Java computes, as bigint).

import { jHashCode, lowerRoot } from './javaString';
import { javaTrim, javaSplit } from '../../../lib/javaCompat';

export const WINDOW = 40;

export type Shingles = Set<bigint>;

/** The first copied run (as text, up to WINDOW words) or null. */
export function findCopy(pageBody: string, sourceTexts: (string | null)[]): string | null {
  const sets: Shingles[] = [];
  for (const source of sourceTexts) if (source != null) sets.push(shinglesOf(source));
  return findCopyIn(pageBody, sets);
}

/**
 * Same against precomputed shingle sets (shinglesOf): an import builds
 * each source's set once and reuses it for every page citing it.
 */
export function findCopyIn(pageBody: string, sourceShingles: Shingles[]): string | null {
  const page = words(stripLinks(pageBody));
  if (page.length < WINDOW) return null;
  const hashes = wordHashes(page);
  for (const shingles of sourceShingles) {
    if (shingles.size === 0) continue;
    for (let i = 0; i + WINDOW <= page.length; i++) {
      if (shingles.has(hash(hashes, i))) return page.slice(i, i + WINDOW).join(' ');
    }
  }
  return null;
}

/** Hashes of every WINDOW-word run of a source text (empty when shorter). */
export function shinglesOf(sourceText: string | null): Shingles {
  if (sourceText == null) return new Set();
  const src = words(sourceText);
  return src.length < WINDOW ? new Set() : shingles(src);
}

export function words(text: string): string[] {
  const n = javaTrim(lowerRoot(text.normalize('NFC')).replace(/[^\p{L}\p{N}]+/gu, ' '));
  return n.length === 0 ? [] : javaSplit(n, / /);
}

/** [[target|text]] -> text, [[target]] -> nothing (not prose). */
export function stripLinks(body: string): string {
  return body
    .replace(/\[\[[^[\]|\n]+\|([^[\]\n]*)\]\]/g, (_m, t: string) => t)
    .replace(/\[\[[^[\]\n]+\]\]/g, ' ');
}

function shingles(ws: string[]): Shingles {
  const out: Shingles = new Set();
  const hashes = wordHashes(ws);
  for (let i = 0; i + WINDOW <= ws.length; i++) out.add(hash(hashes, i));
  return out;
}

const GOLDEN = BigInt.asIntN(64, 0x9e3779b97f4a7c15n);
const SEED = 1125899906842597n;

// Per word: long w = hashCode * 0x9E3779B97F4A7C15L; w ^= (w >>> 31) + length.
function wordHashes(ws: string[]): bigint[] {
  return ws.map((word) => {
    let w = BigInt.asIntN(64, BigInt(jHashCode(word)) * GOLDEN);
    w = BigInt.asIntN(64, w ^ BigInt.asIntN(64, (BigInt.asUintN(64, w) >> 31n) + BigInt(word.length)));
    return w;
  });
}

// h = 31 * h + w over the window, in 64-bit two's complement.
function hash(wordHash: bigint[], from: number): bigint {
  let h = SEED;
  for (let i = from; i < from + WINDOW; i++) h = BigInt.asIntN(64, 31n * h + wordHash[i]!);
  return h;
}

// Port of apps/api/src/main/java/org/ceitba/api/service/drive/SubjectMatcher.java.
//
// Suggests a subject for a Drive file/folder name. Deliberately simple:
//
//   1. A subject code in the name ("93.41", "93-41", "9341") wins outright.
//   2. Otherwise token overlap, accent- and case-insensitive. Tokens are
//      light-stemmed (plural "s" and a final vowel dropped); a name token of
//      4+ letters also matches a subject token it is a prefix of; a few short
//      abbreviations are expanded ("Fís", "AM", "EDA", "POO"). Filler words
//      never count. Numerals I-VI and 1-6 are the same thing and compared
//      apart from words: a name numeral that contradicts the subject's rules
//      the subject out; a name without one does not. Dates are ignored.
//      Score = share of the subject's words present in the name, with at
//      least one word matched.
//   3. The student's plan subjects are tried first with PLAN_THRESHOLD; only
//      without a plan match, all subjects with THRESHOLD. Ties: higher score,
//      then the subject whose first word matched, then earlier in the plan,
//      then more words, then name.

import { javaCompareStrings, javaIsBlank, javaSplit, javaTrim } from '../../../lib/javaCompat';
import { foldAccentsLower } from '../../../lib/subjectText';

export const THRESHOLD = 0.75;
export const PLAN_THRESHOLD = 0.5;

const CODE = /(?<!\d)(\d{2})[.\-_ ]?(\d{2})(?!\d)/g;
const DATE = /\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?/g;
const LETTER_DIGIT = /(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/g;

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en', 'para', 'con', 'al', 'o', 'u', 'por', 'sus',
  'the', 'of', 'and',
  'resumen', 'resumenes', 'apunte', 'apuntes', 'teoria', 'teorica', 'teoricas', 'practica', 'practicas',
  'tp', 'tps', 'parcial', 'parciales', 'final', 'finales', 'full', 'completo', 'completa', 'clase', 'clases',
  'guia', 'guias', 'ejercicio', 'ejercicios', 'notas', 'material', 'copia', 'ingreso']);
const NUMERALS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi']);
const ARABIC = new Map([['1', 'i'], ['2', 'ii'], ['3', 'iii'], ['4', 'iv'], ['5', 'v'], ['6', 'vi']]);
// Short abbreviations (too short for the prefix rule) -> words.
const ABBREVIATIONS = new Map<string, string[]>(Object.entries({
  fis: ['fisica'],
  am: ['analisis', 'matematico'],
  eda: ['estructuras', 'datos', 'algoritmos'],
  poo: ['programacion', 'orientada', 'objetos'],
  pi: ['programacion', 'imperativa'],
  md: ['matematica', 'discreta'],
  qca: ['quimica'],
}));

export interface Tokens {
  /** Insertion-ordered (LinkedHashSet). */
  words: Set<string>;
  numerals: Set<string>;
  firstWord: string | null;
}

interface Candidate {
  id: string;
  name: string;
  tokens: Tokens;
  planOrder: number;
}

interface Scored {
  c: Candidate;
  score: number;
  leading: boolean;
  matched: number;
}

const INT_MAX = 2147483647;

export class SubjectMatcher {
  private readonly codes = new Set<string>();
  private readonly all: Candidate[] = [];
  private readonly plan: Candidate[] = [];

  /**
   * subjects: id (code like "93.41") -> name, in the map's iteration order.
   * planSubjectIds: the student's plan subjects in plan order (year, semester).
   */
  constructor(subjects: Iterable<readonly [string, string]> | ReadonlyMap<string, string>, planSubjectIds: readonly string[] = []) {
    const order = new Map<string, number>();
    planSubjectIds.forEach((id, i) => {
      if (!order.has(id)) order.set(id, i);
    });
    for (const [id, name] of subjects) {
      this.codes.add(id);
      const t = tokens(name);
      if (t.words.size === 0) continue;
      const c: Candidate = { id, name, tokens: t, planOrder: order.get(id) ?? INT_MAX };
      this.all.push(c);
      if (order.has(id)) this.plan.push(c);
    }
  }

  /** The subject id, or null (Optional.empty()). */
  match(text: string | null | undefined): string | null {
    if (text == null || javaIsBlank(text)) return null;
    for (const m of text.matchAll(CODE)) {
      const code = `${m[1]}.${m[2]}`;
      if (this.codes.has(code)) return code;
    }
    const name = tokens(text);
    if (name.words.size === 0) return null;
    return best(this.plan, name, PLAN_THRESHOLD) ?? best(this.all, name, THRESHOLD);
  }
}

function compareScored(a: Scored, b: Scored): number {
  if (a.score !== b.score) return b.score - a.score > 0 ? 1 : -1; // comparingDouble(-score)
  if (a.leading !== b.leading) return a.leading ? -1 : 1;          // thenComparing(!leading)
  if (a.c.planOrder !== b.c.planOrder) return a.c.planOrder < b.c.planOrder ? -1 : 1;
  if (a.matched !== b.matched) return b.matched < a.matched ? -1 : 1; // -matched
  return javaCompareStrings(a.c.name, b.c.name);
}

function best(candidates: Candidate[], name: Tokens, threshold: number): string | null {
  let min: Scored | null = null;
  for (const c of candidates) {
    const s = score(c, name);
    if (s == null || !(s.score >= threshold)) continue;
    if (min == null || compareScored(s, min) < 0) min = s;
  }
  return min?.c.id ?? null;
}

function score(c: Candidate, name: Tokens): Scored | null {
  const subject = c.tokens;
  if (name.numerals.size > 0 && subject.numerals.size > 0 && ![...name.numerals].some((n) => subject.numerals.has(n))) {
    return null;
  }
  let matched = 0;
  let leading = false;
  for (const w of subject.words) {
    if (matches(name.words, w)) {
      matched++;
      if (w === subject.firstWord) leading = true;
    }
  }
  if (matched === 0) return null;
  return { c, score: matched / subject.words.size, leading, matched };
}

function matches(nameWords: Set<string>, subjectWord: string): boolean {
  if (nameWords.has(subjectWord)) return true;
  for (const n of nameWords) {
    if (n.length >= 4 && subjectWord.startsWith(n)) return true;
  }
  return false;
}

export function tokens(s: string): Tokens {
  let text = foldAccentsLower(s).replace(DATE, ' ');
  text = text.replace(LETTER_DIGIT, ' ');
  const words = new Set<string>();
  const numerals = new Set<string>();
  let first: string | null = null;
  for (const raw of javaSplit(javaTrim(text.replace(/[^a-z0-9]+/g, ' ')), / /)) {
    if (raw.length === 0 || STOPWORDS.has(raw)) continue;
    const numeral = ARABIC.get(raw) ?? raw;
    if (NUMERALS.has(numeral)) {
      numerals.add(numeral);
      continue;
    }
    if (/^[0-9]*$/.test(raw)) continue;
    const expanded = ABBREVIATIONS.get(raw) ?? [raw];
    for (const w of expanded) {
      if (STOPWORDS.has(w)) continue;
      const st = stem(w);
      if (first == null) first = st;
      words.add(st);
    }
  }
  return { words, numerals, firstWord: first };
}

/** matematicas -> matematic, fisica -> fisic, datos -> dat. */
export function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith('s')) s = s.slice(0, -1);
  if (s.length > 4 && 'aeo'.includes(s[s.length - 1]!)) s = s.slice(0, -1);
  return s;
}


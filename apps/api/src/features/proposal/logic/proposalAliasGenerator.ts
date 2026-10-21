// Port of apps/api/src/main/java/org/ceitba/api/service/proposal/ProposalAliasGenerator.java.
//
// Picks a pseudonym "<GreekLetter><Color>" (e.g. "AlfaRojo", the format the
// Firestore app used) that is not yet taken on a proposal. Once all letter x
// color combinations are used, a numeric suffix is added ("AlfaRojo2"), so
// generation always terminates. Words: ../resources/alias-words.json (a
// byte-identical copy of apps/api/src/main/resources/proposals/alias-words.json).
//
// TODO(proposal-service): ProposalAliasService.aliasFor (find or create the
// alias under the proposal row lock) is repository code.

import { randomInt } from 'node:crypto';
import { javaTrim } from '../../../lib/javaCompat';
import words from '../resources/alias-words.json';

/** java.util.random.RandomGenerator: what next() needs. */
export interface RandomIntSource { nextInt(bound: number): number }

/** SecureRandom (the production default). */
export const secureRandom: RandomIntSource = { nextInt: (bound) => randomInt(bound) };

export class ProposalAliasGenerator {
  private readonly combos: readonly string[];

  constructor(combos: readonly string[] = loadCombos(), private readonly random: RandomIntSource = secureRandom) {
    if (combos.length === 0) throw new Error('alias word list is empty');
    this.combos = [...combos];
  }

  next(taken: ReadonlySet<string>): string {
    const free = this.combos.filter((c) => !taken.has(c));
    if (free.length > 0) return free[this.random.nextInt(free.length)]!;
    const base = this.combos[this.random.nextInt(this.combos.length)]!;
    for (let n = 2; ; n++) {
      const candidate = base + n;
      if (!taken.has(candidate)) return candidate;
    }
  }

  size(): number {
    return this.combos.length;
  }
}

export function loadCombos(): string[] {
  const out: string[] = [];
  for (const letter of words.greekLetters) {
    for (const color of words.colors) out.push(titleCase(letter) + titleCase(color));
  }
  return out;
}

/** trim, toLowerCase(es), first UTF-16 unit toUpperCase(es). */
function titleCase(word: string): string {
  const w = javaTrim(word).toLowerCase();
  return w.length === 0 ? w : w.slice(0, 1).toUpperCase() + w.slice(1);
}

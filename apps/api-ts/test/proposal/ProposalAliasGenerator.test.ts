// Port of apps/api/src/test/java/org/ceitba/api/service/proposal/ProposalAliasGeneratorTest.java
import { describe, expect, test } from 'bun:test';
import { loadCombos, ProposalAliasGenerator } from '../../src/features/proposal/logic/proposalAliasGenerator';
import { INTEROP } from '../interop/java-golden';
import { JavaRandom } from './support/JavaRandom';

describe('ProposalAliasGeneratorTest', () => {
  test('portedWordListGivesGreekLetterTimesColorCombos', () => {
    const combos = loadCombos();
    expect(combos).toHaveLength(24 * 20);
    expect(new Set(combos).size).toBe(combos.length);
    for (const c of ['AlfaRojo', 'ÉpsilonAzul', 'OmegaIndigo']) expect(combos).toContain(c);
    for (const c of combos) {
      expect(c.length).toBeLessThanOrEqual(40);
      expect(c).toMatch(/^\p{Lu}\p{Ll}+\p{Lu}\p{Ll}+$/u);
    }
  });

  test('neverReturnsATakenAliasAndFallsBackToSuffixes', () => {
    const gen = new ProposalAliasGenerator(['AlfaRojo', 'BetaAzul'], new JavaRandom(42));
    const taken = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const next = gen.next(taken);
      expect(taken.has(next)).toBe(false);
      taken.add(next);
    }
    expect(taken.has('AlfaRojo')).toBe(true);
    expect(taken.has('BetaAzul')).toBe(true);
    expect([...taken].some((a) => /^(AlfaRojo|BetaAzul)[2-9]$/.test(a))).toBe(true);
  });

  test('defaultGeneratorCoversEveryCombo', () => {
    const gen = new ProposalAliasGenerator();
    const taken = new Set<string>();
    for (let i = 0; i < gen.size(); i++) taken.add(gen.next(taken));
    expect(taken.size).toBe(gen.size());
    expect([...taken].every((a) => !/[0-9]$/.test(a))).toBe(true);
  });
});

describe('interop: ProposalAliasGenerator against Java', () => {
  test('same combos in the same order, and the same picks for new Random(42)', () => {
    expect(loadCombos()).toEqual(INTEROP.aliases.combos);
    const gen = new ProposalAliasGenerator(['AlfaRojo', 'BetaAzul'], new JavaRandom(42));
    const taken = new Set<string>();
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = gen.next(taken);
      picks.push(n);
      taken.add(n);
    }
    expect(picks).toEqual(INTEROP.aliases.random42);
  });
});

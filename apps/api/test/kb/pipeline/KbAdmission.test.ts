// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbAdmissionTest.java
// Cost-based, smallest-first admission of dirty subjects into a run.
import { describe, expect, test } from 'bun:test';
import { dec, type Dec } from '../../../src/features/kb/logic/decimal';
import { batchByRule } from '../../../src/features/kb/logic/llm/kbChatPayloads';
import { cost } from '../../../src/features/kb/logic/llm/kbPricing';
import { Odt } from '../../../src/features/kb/logic/odt';
import { admit, type Candidate } from '../../../src/features/kb/logic/pipeline/kbAdmission';
import { KbModel } from '../../../src/features/kb/logic/types';

function model(id: string, input: string, output: string, discount: string): KbModel {
  const m = new KbModel(id, id, 'x', batchByRule(id), true);
  m.setPrices(dec(input), dec(output), null, dec(discount), null);
  return m;
}

const c = (id: string, usd: string, tokens: number): Candidate => ({ subjectId: id, costUsd: dec(usd), inputTokens: tokens, dirtySince: null });
const cand = (id: string, usd: Dec, tokens: number, dirtySince: Odt | null): Candidate => ({ subjectId: id, costUsd: usd, inputTokens: tokens, dirtySince });
const ids = (l: Candidate[]) => l.map((x) => x.subjectId);

describe('KbAdmissionTest', () => {
  // Cheap DIGEST tokens (nano batch) weigh far less than WRITE tokens (sync):
  // a subject with 10x the tokens but all in DIGEST costs less, so it is
  // admitted where the small, WRITE-heavy one is not.
  test('admissionIsByMoneyNotTokens', () => {
    const nano = model('gpt-5-nano', '0.05', '0.40', '0.5'); // batch: 0.025 / 0.20
    const luna = model('luna', '0.10', '0.50', '0.5'); // sync
    const huge = cost(nano, 'BATCH', 5_000_000, 0, 400).add(cost(luna, 'SYNC', 20_000, 0, 5_000)); // ~US$ 0.13, 5M tokens
    const small = cost(luna, 'SYNC', 3_000_000, 0, 2_000_000); // ~US$ 1.30, 3M tokens
    expect(huge.lt(small)).toBe(true);
    const result = admit([cand('small-write-heavy', small, 3_000_000, null), cand('huge-digest', huge, 5_020_000, null)], dec('1.00'), 50_000_000);
    expect(ids(result.admitted)).toEqual(['huge-digest']);
    expect(ids(result.deferred)).toEqual(['small-write-heavy']);
    expect(result.oversized).toBeNull();
    expect(result.deferredUsd().eq(small)).toBe(true);
  });

  test('firstCandidateAloneOverBudgetRunsAloneThenNothingElse', () => {
    const result = admit([c('a', '7.00', 10), c('b', '9.00', 10), c('c', '12.00', 10)], dec('5.00'), 50_000_000);
    expect(ids(result.admitted)).toEqual(['a']);
    expect(result.oversized!.subjectId).toBe('a');
    expect(ids(result.deferred)).toEqual(['b', 'c']);
    // A big subject behind admitted ones is just deferred (it gets its own run later).
    const mixed = admit([c('a', '1.00', 10), c('big', '9.00', 10)], dec('5.00'), 50_000_000);
    expect(ids(mixed.admitted)).toEqual(['a']);
    expect(mixed.oversized).toBeNull();
    // The secondary token cap also applies.
    const tokens = admit([c('a', '0.10', 600), c('b', '0.10', 600)], dec('5.00'), 1000);
    expect(tokens.admitted).toHaveLength(1);
    expect(tokens.deferred).toHaveLength(1);
  });

  test('smallestFirstTiesBrokenByOldestDirty', () => {
    const t0 = Odt.parse('2026-01-01T00:00:00Z');
    const result = admit(
      [
        c('zzz-big', '2.00', 10),
        cand('recent', dec('1.00'), 10, t0.plusSeconds(30 * 86400)),
        cand('old', dec('1.00'), 10, t0),
        cand('never-compiled', dec('1.00'), 10, null),
        c('tiny', '0.01', 10),
      ],
      dec('100'),
      50_000_000,
    );
    expect(ids(result.admitted)).toEqual(['tiny', 'never-compiled', 'old', 'recent', 'zzz-big']);
  });
});

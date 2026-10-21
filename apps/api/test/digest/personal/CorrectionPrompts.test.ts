// Port of apps/api/src/test/java/org/ceitba/api/service/digest/personal/CorrectionPromptsTest.java
import { describe, expect, test } from 'bun:test';
import { compareUuid } from '../../../src/lib/javaCompat';
import { correctionOrder, selectCorrectionPrompts } from '../../../src/features/digest/logic/personal/correctionPrompts';
import type { ScheduleCorrectionRow, ScheduleCorrectionStatus } from '../../../src/features/digest/logic/personal/types';

const READER = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const T0 = Date.parse('2026-09-01T12:00:00-03:00') * 1000;

const correction = (commission: string, suggester: string | null, status: ScheduleCorrectionStatus, confirms: number,
                    minutes: number): ScheduleCorrectionRow => ({
  id: crypto.randomUUID(), commissionId: commission, suggesterId: suggester, status, confirmCount: confirms,
  createdAt: T0 + minutes * 60_000_000,
});

describe('CorrectionPromptsTest', () => {
  test('onlyPendingOnOwnCommissionsNotSuggestedOrVotedByTheReader', () => {
    const ok = correction('c1', OTHER, 'PENDING', 1, 0);
    const anonymousSuggester = correction('c1', null, 'PENDING', 1, 1);
    const own = correction('c1', READER, 'PENDING', 2, 2);
    const voted = correction('c1', OTHER, 'PENDING', 2, 3);
    const applied = correction('c1', OTHER, 'APPLIED', 3, 4);
    const rejected = correction('c1', OTHER, 'REJECTED', 0, 5);
    const otherCommission = correction('c2', OTHER, 'PENDING', 2, 6);

    const picked = selectCorrectionPrompts(READER, new Set(['c1']),
      [ok, anonymousSuggester, own, voted, applied, rejected, otherCommission], new Set([voted.id]), 3);
    expect(picked).toEqual([ok, anonymousSuggester]);
  });

  test('mostConfirmedFirstThenOldestAndCapped', () => {
    const a = correction('c1', OTHER, 'PENDING', 1, 0);
    const b = correction('c1', OTHER, 'PENDING', 2, 5);
    const c = correction('c2', OTHER, 'PENDING', 2, 1);
    const d = correction('c2', OTHER, 'PENDING', 0, 2);
    expect(selectCorrectionPrompts(READER, new Set(['c1', 'c2']), [a, b, c, d], new Set(), 3)).toEqual([c, b, a]);
    expect(selectCorrectionPrompts(READER, new Set(['c1', 'c2']), [a, b], new Set(), 0)).toEqual([]);
    expect(selectCorrectionPrompts(READER, new Set(), [a, b], new Set(), 3)).toEqual([]);
  });
});

describe('interop: UUID.compareTo tie-break', () => {
  test('ids compare as signed 64-bit halves like java.util.UUID', () => {
    const lo = { ...correction('c', OTHER, 'PENDING', 1, 0), id: '7fffffff-ffff-ffff-ffff-ffffffffffff' };
    const hi = { ...lo, id: '80000000-0000-0000-0000-000000000000' };
    // 0x8000... is negative as a signed long: it sorts first.
    expect(correctionOrder(hi, lo)).toBeLessThan(0);
    expect(compareUuid('00000000-0000-0000-8000-000000000000', '00000000-0000-0000-0000-000000000001')).toBe(-1);
  });
});

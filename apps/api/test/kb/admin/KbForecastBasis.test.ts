// Port of apps/api/src/test/java/org/ceitba/api/service/kb/admin/KbForecastBasisTest.java
// Forecast basis selection (ADMIN doc §7).
import { describe, expect, test } from 'bun:test';
import { basis, blend, quantiles, weekly } from '../../../src/features/kb/logic/admin/kbForecast';
import { cron6 } from '../../../src/features/kb/logic/admin/kbSettings';
import { Dec, dec } from '../../../src/features/kb/logic/decimal';

const eqc = (actual: Dec, expected: string) =>
  expect({ v: actual.toString(), eq: actual.eq(dec(expected)) }).toMatchObject({ eq: true });

describe('KbForecastBasisTest', () => {
  test('basisFollowsTheNumberOfCompletedRuns', () => {
    expect(basis(0)).toBe('corpus');
    expect(basis(1)).toBe('blend');
    expect(basis(2)).toBe('blend');
    expect(basis(3)).toBe('history');
    expect(basis(8)).toBe('history');
  });

  test('blendWeightsHistoryByRunsOverThree', () => {
    const w = dec('0.333333');
    expect(Math.abs(blend(dec('3'), dec('6'), w).toNumber() - 5.0)).toBeLessThanOrEqual(0.001);
  });

  test('weeklyNeverBelowTheBacklog', () => {
    const raised = weekly(Dec.ZERO, Dec.ZERO, Dec.ZERO, dec('0.11'), 'corpus', 0);
    eqc(raised.expectedUsd, '0.11');
    eqc(raised.low, '0.11');
    expect(raised.includesBacklog).toBe(true);
    expect(raised.basis).toBe('corpus');
    const kept = weekly(dec('2'), dec('1'), dec('3'), dec('0.11'), 'history', 5);
    eqc(kept.expectedUsd, '2');
    expect(kept.includesBacklog).toBe(false);
    const none = weekly(Dec.ZERO, Dec.ZERO, Dec.ZERO, Dec.ZERO, 'corpus', 0);
    expect(none.includesBacklog).toBe(false);
  });

  test('cronIsAlwaysSixFields', () => {
    expect(cron6('0 3 * * SUN')).toBe('0 0 3 * * SUN');
    expect(cron6('  0 0 3 * * SUN ')).toBe('0 0 3 * * SUN');
    expect(cron6('30  4 * *  MON')).toBe('0 30 4 * * MON');
  });

  test('quantilesAreP25MedianP75', () => {
    const q = quantiles([dec('4'), dec('1'), dec('3'), dec('2'), dec('5')]);
    eqc(q[0], '2');
    eqc(q[1], '3');
    eqc(q[2], '4');
    eqc(quantiles([])[1], '0');
  });
});

// Unit tests of kb-admin's own helpers (no Java test class: their Java counterparts are
// Spring's CronExpression and Jackson; the expected values below were checked on the jar
// through contract/tests/kb-admin-*.contract.test.ts, which run on both servers).

import { describe, expect, test } from 'bun:test';
import { toJavaJson } from '../../src/lib/json';
import { KbSettingsLogic, kbPipelineProperties } from '../../src/features/kb/logic/admin/kbSettings';
import { kbLlmProperties } from '../../src/features/kb/logic/llm/kbLlmProperties';
import { Odt } from '../../src/features/kb/logic/odt';
import { SpringCron } from '../../src/features/kb-admin/cron';
import { runsPerWeek, settingsHash } from '../../src/features/kb-admin/forecast';
import { jackson, odtJson, readJacksonTree } from '../../src/features/kb-admin/values';

describe('SpringCron', () => {
  test('acceptsWhatSpringAccepts', () => {
    for (const ok of ['0 0 3 * * SUN', '0 */15 * * * *', '@weekly', '@DAILY', '0 0 3 ? * MON-FRI', '0 0 0 L * ?', '0 0 9 * * 1#2',
      '0 0 12 15W * *', '0 0 0 LW * *', '0 0 0 L-3 * *', '0 0 0 * * 5L', '0 0 0 1 JAN,jul *', '0 0 0 * * 7', '5/10 * * * * *', '0 0 3 * * sun']) {
      expect(SpringCron.isValidExpression(ok), ok).toBe(true);
    }
  });

  test('rejectsWhatSpringRejects', () => {
    for (const bad of ['0 3 * * SUN', '0 0 3 * *  * *', '61 0 3 * * SUN', '0 0 25 * * *', 'x y z a b c', '0 0 3 * * SUNDAY', '', '0 0 3 5-1 * *',
      '0 0 0 * * 8', '0 */0 * * * *', '? 0 0 * * *', '0 0 0 32 * *', '0 0 0 * 13 *']) {
      expect(SpringCron.isValidExpression(bad), bad).toBe(false);
    }
  });

  test('runsPerWeekCountsFiresInTheNextSevenDays', () => {
    const from = Odt.parse('2026-10-21T10:00:00-03:00'); // a Wednesday
    expect(runsPerWeek('0 0 3 * * SUN', from)).toBe(1);
    expect(runsPerWeek('0 0 3 * * *', from)).toBe(7);
    expect(runsPerWeek('0 0 3 * * MON-FRI', from)).toBe(5);
    // Both day fields must match (Spring): Mondays that are also days 1-31 = every Monday.
    expect(runsPerWeek('0 0 3 1-31 * MON', from)).toBe(1);
    // No fire in the window still counts as one run; an invalid cron too.
    expect(runsPerWeek('0 0 3 1 1 *', from)).toBe(1);
    expect(runsPerWeek('nope', from)).toBe(1);
    expect(runsPerWeek(null, from)).toBe(1);
    // Every hour: 168 slots, minus the one at `from` itself (next() is strictly after; `end` is excluded).
    expect(runsPerWeek('0 0 * * * *', from)).toBe(167);
    // Every second is capped at 7*24*60.
    expect(runsPerWeek('* * * * * *', from)).toBe(7 * 24 * 60);
    // Strictly after `from`: a fire at that very second is not counted, the one a week later is not either.
    expect(runsPerWeek('0 0 10 * * WED', from)).toBe(1);
  });
});

describe('values', () => {
  test('readJacksonTreeKeepsDoubleNodes', () => {
    expect(toJavaJson(readJacksonTree('{"a":5.0,"b":5,"c":1e3,"d":2.50,"e":[1.5,2]}'))).toBe('{"a":5.0,"b":5,"c":1000.0,"d":2.5,"e":[1.5,2]}');
  });

  test('odtJsonIsJacksonsIsoOffsetDateTime', () => {
    expect(odtJson(Odt.parse('2026-01-02T03:04Z'))).toBe('2026-01-02T03:04:00Z');
    expect(odtJson(Odt.parse('2026-01-02T03:04:05.500-03:00'))).toBe('2026-01-02T03:04:05.5-03:00');
    expect(odtJson(Odt.parse('2026-01-02T03:04:05.123456Z'))).toBe('2026-01-02T03:04:05.123456Z');
    expect(odtJson(null)).toBeNull();
    expect(jackson<unknown>({ at: Odt.parse('2026-01-02T03:04Z'), n: [Odt.parse('2026-01-02T03:04:01Z')] })).toEqual({ at: '2026-01-02T03:04:00Z', n: ['2026-01-02T03:04:01Z'] });
  });

  test('settingsHashIsTheFirstEightBytesOfTheRecordJson', () => {
    const logic = new KbSettingsLogic(kbPipelineProperties(), kbLlmProperties(null, null, null, null, false));
    const a = settingsHash(logic.merge({}));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(settingsHash(logic.merge({ modelPlan: 'x' }))).not.toBe(a);
    expect(settingsHash(logic.merge({}))).toBe(a);
  });
});

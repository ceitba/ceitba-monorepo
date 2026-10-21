// Port of apps/api/src/test/java/org/ceitba/api/service/kb/eval/KbEvalMetricsTest.java
import { describe, expect, test } from 'bun:test';
import { dec } from '../../../src/features/kb/logic/decimal';
import { configKey, pageKey } from '../../../src/features/kb/logic/eval/kbEvalKeys';
import { compute, grounding, PageInput } from '../../../src/features/kb/logic/eval/kbEvalMetrics';
import { asDouble, asInt, at, decimalValue, path } from '../../../src/features/kb/logic/jsonNode';

const F = '11111111-1111-1111-1111-111111111111';

function page(body: string): string {
  return '---\ntitle: "T"\nsubject: "61.12"\ntype: concept\nsummary: "S"\nsources: ["' + F + '"]\ngenerator: test\ngenerated_at: 2026-10-02\n---\n\n' + body;
}

describe('KbEvalMetricsTest', () => {
  test('groundingFlagsClaimsWhoseAnchorsAreNotInTheSources', () => {
    const source = 'La TIR es la tasa que anula el VAN. Ejemplo: tasa de 12% anual.';
    const g = grounding(
      `## Tasa
La TIR anula el VAN [[file:${F}]].
El ejemplo usa una tasa del 12 por ciento.
Según Fisher la tasa real es 7.5 por ciento.
Esto es una idea general sin datos.
`,
      source,
    );
    expect(g[0]).toBe(3); // TIR/VAN, 12, Fisher/7.5 (heading has no anchors)
    expect(g[1]).toBe(1); // Fisher / 7.5 unsupported
  });

  test('computeCountsValidityCitationsAndEmptyToolCalls', () => {
    const good = page('## A\nTexto propio [[file:' + F + ']].\n');
    const bad = page('## A\nSin cita.\n');
    const pages = [
      new PageInput('a', good, [], 0, null, [], 'texto'),
      new PageInput('b', bad, ["section 'A' has no [[file:...]] citation"], 1, good, [], 'texto'),
      new PageInput('c', null, ['no answer from the model: x'], 0, null, [], ''),
    ];
    const m = compute(pages, 3, { inputTokens: 1000, outputTokens: 200, costUsd: dec('0.02'), requests: 4, emptyToolCalls: 1 }, 30);
    expect(asInt(path(m, 'pagesPlanned'))).toBe(3);
    expect(asInt(path(m, 'pagesWritten'))).toBe(2);
    expect(asInt(path(m, 'validPages'))).toBe(2);
    expect(asDouble(path(m, 'firstPassValidRate'))).toBe(0.5);
    expect(asInt(path(m, 'uncitedSections'))).toBe(1);
    expect(asInt(path(m, 'coverageViolations'))).toBe(1);
    expect(asInt(at(m, 'rejectReasons', 'uncited_section'))).toBe(1);
    expect(asInt(at(m, 'rejectReasons', 'no_answer'))).toBe(1);
    expect(asDouble(path(m, 'emptyToolCallRate'))).toBe(0.25);
    expect(decimalValue(path(m, 'costPerValidPage')).eq(dec('0.01'))).toBe(true);
  });

  test('configKeysCarryEfforts', () => {
    expect(configKey('glm-5.3', 'low', 'glm-5.3', 'medium')).toBe('glm-5.3@low|glm-5.3@medium');
    expect(configKey('a', null, 'b', null)).toBe('a|b');
    expect(pageKey(F, 'glm-5.3@low|glm-5.3', '61.12', 'tir')).toBe('kb/evals/' + F + '/glm-5.3_at_low__glm-5.3/61.12/tir.md');
  });
});

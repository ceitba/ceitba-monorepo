// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbMustCoverTest.java
import { describe, expect, test } from 'bun:test';
import { asText, readTree, type JsonValue } from '../../src/features/kb/logic/jsonNode';
import { MAX_CHARS, MAX_ITEMS, missingFormulaErrors, normalize } from '../../src/features/kb/logic/kbMustCover';

describe('KbMustCoverTest', () => {
  test('normalizeTrimsCapsAndTurnsInvalidIntoEmpty', () => {
    const items: JsonValue[] = ['  a  ', '', 5, 'x'.repeat(400)];
    for (let i = 0; i < 12; i++) items.push('i' + i);
    const out = normalize(items);
    expect(out).toHaveLength(MAX_ITEMS);
    expect(asText(out[0])).toBe('a');
    expect(asText(out[1])).toHaveLength(MAX_CHARS);
    expect(normalize(readTree('"nope"'))).toEqual([]);
    expect(normalize(null)).toEqual([]);
  });

  test('missingFormulaOnlyWhenLatexIsRequiredAndThePageHasNoMath', () => {
    const latex = readTree('["Definición", "IC: \\\\bar X \\\\pm t"]');
    const errors = missingFormulaErrors(latex, 'Texto sin fórmulas');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.startsWith('missing_formula: the plan required formulas (IC: \\bar X \\pm t)')).toBe(true);
    expect(missingFormulaErrors(latex, 'Media $\\bar X$ aquí')).toEqual([]);
    expect(missingFormulaErrors(readTree('["Definición de media"]'), 'sin math')).toEqual([]);
  });
});

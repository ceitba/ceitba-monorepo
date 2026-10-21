// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbPlanCheckTest.java
import { describe, expect, test } from 'bun:test';
import { KbPlanCheck, normalizeIndexSlug } from '../../../src/features/kb/logic/pipeline/kbPlanCheck';

describe('KbPlanCheckTest', () => {
  test('indexOnlyPlanIsInsufficientOnFirstCompileWithSeveralSources', () => {
    const check = new KbPlanCheck(['x']);
    check.firstCompile(2);
    check.keptPage('index');
    expect(check.indexOnly()).toBe(true);
    check.keptPage('media-muestral');
    expect(check.indexOnly()).toBe(false);

    const single = new KbPlanCheck(null);
    single.firstCompile(1);
    single.keptPage('index');
    expect(single.insufficient()).toBe(false);
    expect(normalizeIndexSlug('Índice', 'index')).toBe('index');
    expect(normalizeIndexSlug('indice', 'concept')).toBe('indice');
  });
});

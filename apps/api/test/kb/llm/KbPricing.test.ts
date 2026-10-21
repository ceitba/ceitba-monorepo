// Port of apps/api/src/test/java/org/ceitba/api/service/kb/llm/KbPricingTest.java
// Effective prices and request cost (ADMIN doc §2, §7).
import { describe, expect, test } from 'bun:test';
import { dec, type Dec } from '../../../src/features/kb/logic/decimal';
import { batchByRule } from '../../../src/features/kb/logic/llm/kbChatPayloads';
import { cost, effective } from '../../../src/features/kb/logic/llm/kbPricing';
import { KbModel } from '../../../src/features/kb/logic/types';

function model(id: string, input: string, output: string, cache: string | null, discount: string | null): KbModel {
  const m = new KbModel(id, id, 'x', batchByRule(id), true);
  m.setPrices(dec(input), dec(output), cache == null ? null : dec(cache), discount == null ? null : dec(discount), null);
  return m;
}

/** isEqualByComparingTo */
const eqc = (actual: Dec | null | undefined, expected: string | Dec) =>
  expect({ v: actual?.toString(), eq: actual != null && actual.eq(typeof expected === 'string' ? dec(expected) : expected) })
    .toMatchObject({ eq: true });

describe('KbPricingTest', () => {
  test('syncPaysListPrice', () => {
    const haiku = model('anthropic-claude-haiku-4.5', '1.00', '5.00', '0.10', '0.5');
    // 1M uncached in + 1M out = 1 + 5
    eqc(cost(haiku, 'SYNC', 1_000_000, 0, 1_000_000), '6');
    const p = effective(haiku, 'SYNC')!;
    eqc(p.inputPerM, '1');
    eqc(p.outputPerM, '5');
  });

  test('batchTakesTheDiscountOffEverythingIncludingCachedInput', () => {
    const haiku = model('anthropic-claude-haiku-4.5', '1.00', '5.00', '0.10', '0.5');
    eqc(cost(haiku, 'BATCH', 1_000_000, 0, 1_000_000), '3');
    const p = effective(haiku, 'BATCH')!;
    eqc(p.inputPerM, '0.5');
    eqc(p.outputPerM, '2.5');
    eqc(p.cacheReadPerM, '0.05');
    // A different discount is honoured.
    const other = model('anthropic-claude-sonnet-5.5', '2.00', '10.00', '0.20', '0.3');
    eqc(cost(other, 'BATCH', 1_000_000, 0, 0), '1.4');
  });

  test('cachedInputIsBilledAtCacheReadPrice', () => {
    const glm = model('glm-5.3', '1.40', '4.40', '0.26', '0.5');
    // 1M input of which 600k cached: 0.4 * 1.40 + 0.6 * 0.26 = 0.716
    eqc(cost(glm, 'SYNC', 1_000_000, 600_000, 0), '0.716');
    // Cached tokens beyond the input are clamped.
    eqc(cost(glm, 'SYNC', 100, 1000, 0), cost(glm, 'SYNC', 100, 100, 0));
    // Without a cache price, cached input pays the input price.
    const noCache = model('openai-gpt-oss-120b', '0.10', '0.70', null, '0.5');
    eqc(cost(noCache, 'SYNC', 1_000_000, 500_000, 0), '0.1');
  });

  test('unknownModelCostsNothingAndBatchRule', () => {
    eqc(cost(null, 'SYNC', 1000, 0, 1000), '0');
    expect(effective(null, 'SYNC')).toBeNull();
    expect(batchByRule('anthropic-claude-haiku-4.5')).toBe(true);
    expect(batchByRule('openai-gpt-5')).toBe(true);
    expect(batchByRule('openai-gpt-oss-120b')).toBe(false);
    for (const m of ['glm-5.3', 'deepseek-4-flash', 'qwen3.8-max', 'kimi-k2.6', 'llama3.3-70b']) {
      expect({ m, rule: batchByRule(m) }).toEqual({ m, rule: false });
    }
  });
});

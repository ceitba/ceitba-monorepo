// Port of apps/api/src/test/java/org/ceitba/api/service/kb/admin/KbCatalogItemTest.java
// DO's public catalog (recorded fixture, copied from apps/api/src/test/resources/kb): per-token
// prices despite the field names.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { KbCatalogItem } from '../../../src/features/kb/logic/admin/kbCatalogItem';
import { dec, type Dec } from '../../../src/features/kb/logic/decimal';
import { elements, path, readTree } from '../../../src/features/kb/logic/jsonNode';

function items(): Map<string, KbCatalogItem> {
  const root = readTree(readFileSync(new URL('../fixtures/do-model-catalog.json', import.meta.url), 'utf8'));
  const out = new Map<string, KbCatalogItem>();
  for (const n of elements(path(root, 'data'))) {
    const i = KbCatalogItem.of(n);
    out.set(i.id!, i);
  }
  return out;
}

/** isEqualByComparingTo */
const eqc = (actual: Dec | null, expected: string) =>
  expect({ v: actual?.toString(), eq: actual != null && actual.eq(dec(expected)) }).toMatchObject({ eq: true });

describe('KbCatalogItemTest', () => {
  test('perTokenPricesAreConvertedToPerMillion', () => {
    const glm = items().get('glm-5.3')!;
    eqc(glm.inputPerM, '1.40');
    eqc(glm.outputPerM, '4.40');
    eqc(glm.cacheReadPerM, '0.26');
    expect(glm.perTokenFields).toEqual(['input', 'output', 'cacheRead']);
    const flash = items().get('glm-5.3-flash')!;
    eqc(flash.inputPerM, '0.15');
    eqc(flash.outputPerM, '0.50');
    eqc(flash.cacheReadPerM, '0.03'); // from input_cache_read
    expect(flash.creator).toBe('zhipu');
    eqc(items().get('deepseek-4-flash')!.cacheReadPerM, '0.028');
    eqc(items().get('openai-gpt-oss-120b')!.outputPerM, '0.70');
  });

  test('valuesAlreadyPerMillionAreKept', () => {
    const haiku = items().get('anthropic-claude-haiku-4.5')!;
    eqc(haiku.inputPerM, '1');
    eqc(haiku.outputPerM, '5');
    eqc(haiku.cacheReadPerM, '0.10');
    expect(haiku.perTokenFields).toEqual([]);
  });

  test('numbersAsStringsAndFilters', () => {
    const glm = items().get('glm-5.3')!;
    expect(glm.contextWindow).toBe(200000);
    expect(glm.maxOutputTokens).toBe(128000);
    expect(glm.has('reasoning')).toBe(true);
    expect(items().get('anthropic-claude-haiku-4.5')!.has('tool_calling')).toBe(false); // unreliable
    expect(items().get('dedicated-only-x')!.serverlessChat()).toBe(false);
    expect(items().get('some-embedding')!.serverlessChat()).toBe(false);
    expect(items().get('kimi-k2.6')!.serverlessChat()).toBe(true);
    expect(items().get('kimi-k2.6')!.cacheReadPerM).toBeNull();
    // OpenAI's GPT-5/6 models are listed as "reasoning": still chat completions.
    const luna = KbCatalogItem.of(readTree('{"model_id":"openai-gpt-6-luna","type":"reasoning","availability":["serverless"]}'));
    expect(luna.serverlessChat()).toBe(true);
    const image = KbCatalogItem.of(readTree('{"model_id":"img","type":"image","availability":["serverless"]}'));
    expect(image.serverlessChat()).toBe(false);
    // Long creators are cut to the provider column (32).
    const node = readTree('{"model_id":"m","creator":"UKP Lab (Technical University of Darmstadt)"}');
    expect(KbCatalogItem.of(node).creator).toHaveLength(32);
  });
});

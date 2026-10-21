// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbPlanSchemaTest.java
import { describe, expect, test } from 'bun:test';
import { asText, at, elements, path, readTree, size } from '../../../src/features/kb/logic/jsonNode';
import { correction, KbPlanCheck, NO_SOURCES } from '../../../src/features/kb/logic/pipeline/kbPlanCheck';
import { KbPayloads } from '../../../src/features/kb/logic/pipeline/kbPayloads';

describe('KbPlanSchemaTest', () => {
  test('planOperationsRequireEveryFieldAndDescribeSources', () => {
    const tool = new KbPayloads(null).tool('plan');
    const op = at(tool, 'input_schema', 'properties', 'operations', 'items');
    const required = elements(path(op, 'required')).map((n) => asText(n));
    expect([...required].sort()).toEqual(['op', 'slug', 'type', 'title', 'sources', 'reason', 'mustCover'].sort());
    expect(required).toHaveLength(7);
    expect(asText(at(op, 'properties', 'sources', 'description'))).toContain('exactly as given');
  });

  test('retriesOnlyWhenTheModelProposedOperationsAndNoneWasKept', () => {
    const proposed = readTree('[{"op":"create","slug":"teorema-central-limite","type":"concept"}]');
    const check = new KbPlanCheck(proposed);
    check.droppedForSources(at(proposed, 0, 'sources'));
    expect(check.emptyAfterFiltering()).toBe(true);
    expect(check.droppedByReason().get(NO_SOURCES)).toBe(1);

    expect(new KbPlanCheck([]).emptyAfterFiltering()).toBe(false); // nothing to change
    const some = new KbPlanCheck(proposed);
    some.kept();
    expect(some.emptyAfterFiltering()).toBe(false);
  });

  test('correctionIsAppendedToTheUserMessage', () => {
    const payloads = new KbPayloads(null);
    const params = payloads.params('m', 'plan', 1000, 'stable', 'variable');
    const redo = payloads.withNote(params, correction(['id-1', 'id-2']));
    const content = at(redo, 'messages', 0, 'content');
    expect(size(content)).toBe(3);
    expect(asText(at(content, 2, 'text'))).toContain('id-1, id-2');
    expect(size(at(params, 'messages', 0, 'content'))).toBe(2); // original untouched
  });
});

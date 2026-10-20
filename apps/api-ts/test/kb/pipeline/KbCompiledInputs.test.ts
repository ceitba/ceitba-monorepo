// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbCompiledInputsTest.java
// After PUBLISH only the inputs of pages that made it in count as compiled.
import { describe, expect, test } from 'bun:test';
import { nodeEquals, nodeToString, readTree } from '../../../src/features/kb/logic/jsonNode';
import { compiledInputs } from '../../../src/features/kb/logic/pipeline/kbCompiledInputs';

describe('KbCompiledInputsTest', () => {
  test('failedPagesLeaveTheirInputsDirty', () => {
    const previous = readTree('[{"fileId":"a","fingerprint":"a1"},{"fileId":"b","fingerprint":"b1"},{"fileId":"x","fingerprint":"x1"}]');
    const current = readTree('[{"fileId":"a","fingerprint":"a2"},{"fileId":"b","fingerprint":"b2"},{"fileId":"c","fingerprint":"c1"}]');
    // The page drawing on b and c (and citing the removed x) was rejected.
    const compiled = compiledInputs(previous, current, new Set(['b', 'c', 'x']));
    expect(nodeToString(compiled)).toBe(
      '[{"fileId":"a","fingerprint":"a2"},{"fileId":"b","fingerprint":"b1"},' + '{"fileId":"x","fingerprint":"x1"}]',
    );
    // Nothing failed: exactly the current inputs.
    expect(nodeEquals(compiledInputs(previous, current, new Set()), current)).toBe(true);
  });
});

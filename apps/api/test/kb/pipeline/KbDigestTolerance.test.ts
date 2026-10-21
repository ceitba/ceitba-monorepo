// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbDigestToleranceTest.java
import { describe, expect, test } from 'bun:test';
import { asBoolean, has, nodeToString, path, readTree, size } from '../../../src/features/kb/logic/jsonNode';
import { mergePartial, tolerableMissing } from '../../../src/features/kb/logic/pipeline/kbDigests';
import { withHeadroom } from '../../../src/features/kb/logic/pipeline/kbPayloads';

describe('KbDigestToleranceTest', () => {
  // Reasoning models get room to think on top of the answer budget, never
  // beyond the sync cap or the model's own limit, never below the configured value.
  test('reasoningHeadroom', () => {
    expect(withHeadroom(4000, 'low', null)).toBe(8000);
    expect(withHeadroom(4000, 'medium', null)).toBe(12000);
    expect(withHeadroom(4000, null, null)).toBe(12000);
    expect(withHeadroom(4000, 'high', null)).toBe(20000);
    expect(withHeadroom(20000, 'high', null)).toBe(32000);
    expect(withHeadroom(4000, 'high', 10000)).toBe(10000);
    expect(withHeadroom(12000, 'low', 10000)).toBe(12000);
  });

  // A file with a failed chunk keeps the digest of the others, flagged partial.
  test('partialChunkMerge', () => {
    const ok = readTree('{"topics":[{"name":"Fourier","summary":"s"}]}');
    const merged = mergePartial([ok, null, ok]);
    expect(asBoolean(path(merged, 'partial'))).toBe(true);
    expect(nodeToString(path(merged, 'failedChunks'))).toBe('[1]');
    expect(size(path(merged, 'topics'))).toBe(1);
    expect(has(mergePartial([ok, ok]), 'partial')).toBe(false);
  });

  // Up to 20% of a subject's files may lack a digest; more, or all, fails it.
  test('missingFilesTolerance', () => {
    expect(tolerableMissing(['a'], 5, 0.2)).toEqual(['a']);
    expect(tolerableMissing(['a', 'b'], 5, 0.2)).toBeNull();
    expect(tolerableMissing(['a'], 1, 0.2)).toBeNull();
    expect(tolerableMissing([], 3, 0.2)).toEqual([]);
  });
});

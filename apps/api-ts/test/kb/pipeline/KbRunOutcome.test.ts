// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbRunOutcomeTest.java
// FAILED when every config/subject failed, PARTIAL when some did, else SUCCEEDED.
import { describe, expect, test } from 'bun:test';
import { completed, status } from '../../../src/features/kb/logic/pipeline/kbRunOutcome';

describe('KbRunOutcomeTest', () => {
  test('aggregatesFailures', () => {
    expect(status(1, 1)).toBe('FAILED'); // the eval with its only config failed
    expect(status(3, 3)).toBe('FAILED');
    expect(status(3, 1)).toBe('PARTIAL');
    expect(status(3, 0)).toBe('SUCCEEDED');
    expect(status(0, 0)).toBe('SUCCEEDED'); // nothing to do
  });

  test('partialCountsAsCompleted', () => {
    expect(completed('PARTIAL')).toBe(true);
    expect(completed('SUCCEEDED')).toBe(true);
    expect(completed('FAILED')).toBe(false);
    expect('PARTIAL'.length).toBeLessThanOrEqual(32); // kb_run.status VARCHAR(32)
  });
});

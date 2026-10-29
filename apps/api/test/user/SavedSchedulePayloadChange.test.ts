// Port of apps/api/src/test/java/org/ceitba/api/service/user/SavedSchedulePayloadChangeTest.java
// payload_updated_at (digest staleness) must move only on a real change.
import { describe, expect, test } from 'bun:test';
import { payloadChanged } from '../../src/features/user/logic/savedSchedulePayload';

describe('SavedSchedulePayloadChangeTest', () => {
  test('sameContentIsNotAChangeEvenWithDifferentKeyOrderOrNumberTypes', () => {
    const stored = { version: 1, selectedCourses: [{ subjectCode: '61.03' }] };
    const incoming = { selectedCourses: [{ subjectCode: '61.03' }], version: 1 };
    expect(payloadChanged(stored, incoming)).toBe(false);
    expect(payloadChanged(null, {})).toBe(false);
  });

  test('differentContentIsAChange', () => {
    expect(payloadChanged({ selectedCourses: [{ subjectCode: '61.03' }] }, { selectedCourses: [{ subjectCode: '61.04' }] })).toBe(true);
  });
});

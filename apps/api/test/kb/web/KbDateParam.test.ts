// Port of apps/api/src/test/java/org/ceitba/api/web/kb/admin/KbDateParamTest.java
import { describe, expect, test } from 'bun:test';
import { ValidationError } from '../../../src/http/errors';
import { Odt } from '../../../src/features/kb/logic/odt';
import { from, to } from '../../../src/features/kb/logic/web/kbDateParam';

/** OffsetDateTime.equals: same local date-time and offset. */
const same = (a: Odt | null, iso: string) => expect({ a: a?.toString(), eq: a != null && a.equals(Odt.parse(iso)) }).toMatchObject({ eq: true });

describe('KbDateParamTest', () => {
  test('dateOnlyIsTheWholeDayInBuenosAires', () => {
    same(from('2026-07-11'), '2026-07-11T00:00:00-03:00');
    same(to('2026-07-11'), '2026-07-11T23:59:59.999999999-03:00');
  });

  test('fullOffsetDatetimeIsKept', () => {
    same(from('2026-07-11T10:30:00Z'), '2026-07-11T10:30:00Z');
    same(to('2026-07-11T10:30:00.5-03:00'), '2026-07-11T10:30:00.5-03:00');
  });

  test('blankIsAbsentAndGarbageIsAValidationError', () => {
    expect(from(null)).toBeNull();
    expect(to(' ')).toBeNull();
    for (const bad of ['2026-13-01', '11/07/2026', '2026-07-11T10:30', 'ayer', '2026-7-1']) {
      expect(() => from(bad)).toThrow(ValidationError);
    }
  });
});

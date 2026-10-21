// Port of apps/api/src/test/java/org/ceitba/api/service/digest/DigestWeekTest.java
import { describe, expect, test } from 'bun:test';
import { DigestException } from '../../src/features/digest/logic/digestException';
import { DigestWeek } from '../../src/features/digest/logic/digestWeek';
import { ART, formatOffsetDateTime } from '../../src/lib/time';

describe('DigestWeekTest', () => {
  test('rejectsNonMonday', () => {
    let err: unknown;
    try {
      new DigestWeek('2026-10-06');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DigestException);
    expect((err as DigestException).reason).toBe('INVALID_WEEK_START');
  });

  test('coveredWeekAndFollowingWeek', () => {
    const w = new DigestWeek('2026-09-28');
    expect(w.weekEnd()).toBe('2026-10-04');
    expect(w.eventsFrom()).toBe('2026-10-05');
    expect(w.eventsTo()).toBe('2026-10-11');
    expect(formatOffsetDateTime(w.announcedFrom(), ART)).toBe('2026-09-28T00:00:00-03:00');
    expect(formatOffsetDateTime(w.announcedTo(), ART)).toBe('2026-10-05T00:00:00-03:00');
    expect(w.isLaterEvent('2026-10-11')).toBe(false);
    expect(w.isLaterEvent('2026-10-12')).toBe(true);
  });

  test('previousWeekFromAnyDay', () => {
    expect(DigestWeek.previousWeek('2026-10-05').weekStart).toBe('2026-09-28');
    expect(DigestWeek.previousWeek('2026-10-11').weekStart).toBe('2026-09-28');
  });

  test('spanishSubject', () => {
    expect(new DigestWeek('2026-10-05').defaultSubject()).toBe('La semana en ITBA · 5 al 11 de octubre');
    expect(new DigestWeek('2026-09-28').defaultSubject()).toBe('La semana en ITBA · 28 de septiembre al 4 de octubre');
  });
});

// yearInZone: the calendar year of an instant in a zone (drive's ART years, the staff roster's Year.now()).
import { expect, test } from 'bun:test';
import { yearInZone } from '../../src/lib/time';

const us = (iso: string) => Date.parse(iso) * 1000;

test('yearInZoneUsesTheLocalCalendarYear', () => {
  // 2026-01-01T02:00Z is still 2025-12-31 23:00 in Buenos Aires (UTC-3).
  expect(yearInZone(us('2026-01-01T02:00:00Z'))).toBe(2025);
  expect(yearInZone(us('2026-01-01T03:00:00Z'))).toBe(2026);
  expect(yearInZone(us('2026-01-01T02:00:00Z'), 'UTC')).toBe(2026);
  expect(yearInZone(us('2025-12-31T15:30:00Z'), 'Asia/Tokyo')).toBe(2026);
});

// Spring @Scheduled semantics on croner: 6-field cron with names, zones, and
// day-of-month AND day-of-week.
import { expect, test } from 'bun:test';
import { Cron } from 'croner';

const next = (pattern: string, from: string, timezone = 'America/Argentina/Buenos_Aires') =>
  new Cron(pattern, { timezone, domAndDow: true, paused: true }).nextRun(new Date(from))!.toISOString();

test('DigestJob#createWeeklyDraft: 0 5 0 * * MON in ART', () => {
  // Monday 2026-10-26 00:05 ART = 03:05Z.
  expect(next('0 5 0 * * MON', '2026-10-20T12:00:00Z')).toBe('2026-10-26T03:05:00.000Z');
});

test('EventReminderJob: 0 0 18-23 * * * in ART', () => {
  expect(next('0 0 18-23 * * *', '2026-10-20T20:30:00Z')).toBe('2026-10-20T21:00:00.000Z');
});

test('KB pipeline default 0 0 3 * * SUN', () => {
  expect(next('0 0 3 * * SUN', '2026-10-20T00:00:00Z')).toBe('2026-10-25T06:00:00.000Z');
});

test('seconds field and every-minute tick', () => {
  expect(next('0 * * * * *', '2026-10-20T10:00:30Z')).toBe('2026-10-20T10:01:00.000Z');
});

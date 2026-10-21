// service/correction/CorrectionSlots.normalize + key: validation and
// normalization of a proposed slot set. The read-side helpers (fromTimes, sga,
// withRooms, toSchedule, sameSet) are shared with the commission feature in
// src/features/commission/correctionOverlay.ts and reused from there.

import { ValidationError } from '../../../http/errors';
import { javaTrim } from '../../../lib/javaCompat';
import { compareSlots, type CorrectionSlot } from '../../commission/correctionOverlay';

export const MAX_SLOTS = 6;
const EARLIEST = '07:00';
const LATEST = '23:30';
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TIME = /^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$/;

/** web/correction/dto/ScheduleSlotInput(day, time_from|timeFrom, time_to|timeTo). */
export interface ScheduleSlotInput {
  day: string | null;
  timeFrom: string | null;
  timeTo: string | null;
}

export const slotKey = (s: CorrectionSlot) => `${s.day} ${s.from}-${s.to}`;
export const key = (normalized: readonly CorrectionSlot[]) => normalized.map(slotKey).join('|');

/** String.toUpperCase(Locale.ROOT) for the ASCII names that can match a DayOfWeek. */
const upperRoot = (s: string) => s.toUpperCase();

function parseDay(field: string, raw: string | null): string {
  if (raw === null) throw new ValidationError(field, null, 'is required');
  const d = upperRoot(javaTrim(raw));
  if (!DAYS.includes(d) || d === 'SUNDAY') throw new ValidationError(field, raw, 'must be MONDAY..SATURDAY');
  return d;
}

/** LocalTime.parse of `HH:mm[:ss]` -> [h, m, s], or null when out of range. */
function localTime(s: string): [number, number, number] | null {
  const [h, m, sec] = s.split(':').map(Number) as [number, number, number?];
  if (h > 23 || m > 59 || (sec ?? 0) > 59) return null;
  return [h, m, sec ?? 0];
}

function parseTime(field: string, raw: string | null): string {
  if (raw === null || !TIME.test(javaTrim(raw))) throw new ValidationError(field, raw, 'must be HH:mm or HH:mm:ss');
  const t = localTime(javaTrim(raw));
  if (!t) throw new ValidationError(field, raw, 'must be HH:mm or HH:mm:ss');
  if (t[2] !== 0) throw new ValidationError(field, raw, 'must be a whole minute');
  return `${String(t[0]).padStart(2, '0')}:${String(t[1]).padStart(2, '0')}`;
}

/**
 * Validates the request slots and returns them normalized ("HH:mm", sorted by
 * day, start, end). 1..6 slots, MONDAY..SATURDAY, from < to, within
 * 07:00-23:30, no overlap on the same day (back-to-back is fine).
 */
export function normalize(input: readonly (ScheduleSlotInput | null)[] | null): CorrectionSlot[] {
  if (input === null || input.length === 0 || input.length > MAX_SLOTS) {
    throw new ValidationError('schedule', input === null ? null : input.length, `must contain between 1 and ${MAX_SLOTS} slots`);
  }
  const slots: CorrectionSlot[] = [];
  input.forEach((inp, i) => {
    const field = `schedule[${i}]`;
    if (inp === null) throw new ValidationError(field, null, 'slot is required');
    const day = parseDay(`${field}.day`, inp.day);
    const from = parseTime(`${field}.time_from`, inp.timeFrom);
    const to = parseTime(`${field}.time_to`, inp.timeTo);
    const span = `${inp.timeFrom}-${inp.timeTo}`;
    if (!(from < to)) throw new ValidationError(field, span, 'time_from must be before time_to');
    if (from < EARLIEST || to > LATEST) throw new ValidationError(field, span, 'slots must be between 07:00 and 23:30');
    slots.push({ day, from, to });
  });
  slots.sort(compareSlots);
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1]!;
    const cur = slots[i]!;
    if (prev.day === cur.day && prev.to > cur.from) {
      throw new ValidationError('schedule', slotKey(cur), `overlaps ${slotKey(prev)} on the same day`);
    }
  }
  return slots;
}

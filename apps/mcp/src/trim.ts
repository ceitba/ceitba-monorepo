// Helpers that turn API payloads into compact, model-friendly shapes:
// fewer keys, no nulls, short time strings, long text cut with a marker.

import type { ScheduleEntry } from "./api/types";

const DAY_ES: Record<string, string> = {
  MONDAY: "Lun", TUESDAY: "Mar", WEDNESDAY: "Mié", THURSDAY: "Jue", FRIDAY: "Vie", SATURDAY: "Sáb", SUNDAY: "Dom"
};

// "08:00:00" → "08:00"
export const hhmm = (t: string | null | undefined): string => (t ? t.slice(0, 5) : "");

export const dayShort = (day: string): string => DAY_ES[day?.toUpperCase()] ?? day;

// "Lun 08:00-10:00 SDF 101"
export function slot(e: Pick<ScheduleEntry, "day" | "time_from" | "time_to"> & { building?: string | null; classroom?: string | null }): string {
  const place = [e.building, e.classroom].filter(Boolean).join(" ");
  return `${dayShort(e.day)} ${hhmm(e.time_from)}-${hhmm(e.time_to)}${place ? " " + place : ""}`;
}

// Drops null/undefined/empty-string/empty-array values (shallow, recursive into plain objects/arrays).
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => compact(v)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = compact(v);
    }
    return out as T;
  }
  return value;
}

export interface Cut {
  text: string;
  truncated: boolean;
  totalChars: number;
  offset: number;
}

// A window of a long text; callers pass offset to page through it.
export function cut(text: string | null | undefined, maxChars: number, offset = 0): Cut {
  const s = text ?? "";
  const start = Math.max(0, Math.min(offset, s.length));
  const end = Math.min(s.length, start + maxChars);
  return { text: s.slice(start, end), truncated: end < s.length, totalChars: s.length, offset: start };
}

export const clampLimit = (limit: number | undefined, def: number, max: number): number =>
  Math.max(1, Math.min(max, Math.floor(limit ?? def)));

export const normalize = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

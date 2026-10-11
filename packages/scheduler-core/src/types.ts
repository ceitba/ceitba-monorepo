// Types the schedule generator needs. They are the minimal shapes of the API's
// GET /v1/subjects catalog (snake_case), so callers can pass the richer app
// types (apps/web) or a trimmed copy (apps/mcp) without mapping.

export interface SchedulerOptions {
  allowOverlap: boolean;
  allowUnlimitedOverlap: boolean;
  allowFreeDay: boolean;
}

// A period the user doesn't want classes in.
// day is MONDAY..FRIDAY; from/to are "HH:mm".
export interface TimeBlock {
  id?: string;
  day: string;
  from: string;
  to: string;
  label?: string;
}

export interface ScheduleSlot {
  day: string;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  subject: string;
  subject_id: string;
  commission: string;
  // Other commissions of the subject with the very same timetable, building
  // and dates. Generation treats them as one option (they make no difference
  // to the schedule) and lists their names here; `commission` is the first.
  alternatives?: string[];
  building: string;
  classroom: string;
}

export interface PossibleSchedule {
  slots: ScheduleSlot[];
  maxOverlap: number;
  hasBuildingConflict: boolean;
  hasFreeDay: boolean;
  freeDays: number;
  gapMinutes: number;
}

export interface CommissionSchedule {
  day: string;
  time_from: string;
  time_to: string;
  building: string;
  classroom: string;
}

export interface CommissionInput {
  name: string;
  // This commission's own "YYYY-MM-DD" dates; the subject's when missing.
  course_start?: string;
  course_end?: string;
  // EFFECTIVE slots (an applied correction's slots if any, else SGA's).
  schedule: CommissionSchedule[];
}

export interface SubjectInput {
  subject_id: string;
  name: string;
  // "YYYY-MM-DD" calendar dates as sent by the API.
  course_start: string;
  course_end: string;
  commissions: CommissionInput[];
  // Commission names to choose from; empty/missing or containing "any" = all.
  selectedCommissions?: string[];
}

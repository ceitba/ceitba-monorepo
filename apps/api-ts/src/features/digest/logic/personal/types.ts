// Minimal types for "Tu cuatrimestre" (service/digest/personal, domain/correction).
import type { Micros } from '../../../../lib/time';

/** domain/correction/CorrectionSlot: {"day": "TUESDAY", "from": "08:00", "to": "11:00"}. */
export interface CorrectionSlot { day: string; from: string; to: string }

export type ScheduleCorrectionStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | (string & {});

/** The ScheduleCorrection columns CorrectionPrompts reads. */
export interface ScheduleCorrectionRow {
  id: string;
  commissionId: string;
  suggesterId: string | null;
  status: ScheduleCorrectionStatus;
  confirmCount: number;
  createdAt: Micros | null;
}

/** PersonalDigest (record): what "Tu cuatrimestre" shows one reader. */
export interface PersonalDigest {
  state: 'CURRENT' | 'NEEDS_SCHEDULE';
  subjects: SubjectLine[];
  wiki: WikiLink[];
  corrections: CorrectionPrompt[];
}

export const needsSchedule = (): PersonalDigest => ({ state: 'NEEDS_SCHEDULE', subjects: [], wiki: [], corrections: [] });

/** commissionName is null when the schedule doesn't name exactly one. */
export interface SubjectLine { code: string; name: string; commissionName: string | null }

export interface WikiLink { subjectCode: string; subjectName: string; url: string; updatedThisWeek: boolean }

/** Never carries the suggester (or any voter). */
export interface CorrectionPrompt {
  correctionId: string;
  subjectName: string;
  commissionName: string | null;
  proposed: CorrectionSlot[];
  sga: CorrectionSlot[];
}

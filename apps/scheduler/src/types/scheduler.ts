import type { Subject } from "../hooks/useSubjects";

// The generator's shapes are shared with apps/mcp via @ceitba/scheduler-core.
export type {
  SchedulerOptions,
  TimeBlock,
  ScheduleSlot,
  PossibleSchedule,
  CommissionSchedule
} from "@ceitba/scheduler-core";
import type { CommissionSchedule } from "@ceitba/scheduler-core";

export interface SchedulerSubject extends Subject {
  selectedCommissions: string[];
}

export type CorrectionStatus = "PENDING" | "APPLIED" | "REJECTED" | "RESOLVED" | "SUPERSEDED";
export type VoteType = "CONFIRM" | "REJECT";

// A student-suggested schedule for a commission, as embedded in the
// subjects catalog (snake_case like the rest of that response). The catalog
// only carries PENDING and APPLIED ones, APPLIED first, then by confirms.
export interface CommissionCorrection {
  id: string;
  status: CorrectionStatus;
  schedule: CommissionSchedule[];
  // Distinct students; the suggester counts as a confirm.
  confirms: number;
  rejects: number;
  // The caller's vote; always null for anonymous visitors.
  my_vote: VoteType | null;
  created_at: string;
}

export interface Commission {
  name: string;
  // The ITBA commission id, needed to suggest a correction. Optional so the
  // app keeps working against an API that doesn't send it yet.
  commission_id?: string;
  // EFFECTIVE slots: the applied correction's slots if any, else SGA's.
  schedule: CommissionSchedule[];
  // Original SGA slots, present only while a correction is applied.
  sga_schedule?: CommissionSchedule[];
  corrections?: CommissionCorrection[];
}

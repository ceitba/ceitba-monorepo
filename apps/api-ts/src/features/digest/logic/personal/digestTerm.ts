// Port of apps/api/src/main/java/org/ceitba/api/service/digest/personal/DigestTerm.java.
//
// Is a user's primary saved schedule about the current term, and which
// commissions does it pick? (docs/WEEKLY-DIGEST.md, "Tu cuatrimestre".)
//   1. The current term of a subject = its commissions that have not ended and
//      start within LOOKAHEAD_DAYS, narrowed to the newest term with
//      CommissionTerms.
//   2. A schedule entry picks the commissions whose name it lists (none or
//      "any" = every commission of the subject). Entries whose names aren't
//      offered this term, or subjects with no current commission, are dropped.
//   3. Current when at least one entry survives AND it was saved no earlier
//      than PLANNING_LEAD_DAYS before the latest course_start among the picks.
// The user's own commission of a subject is known only when the entry names exactly one.

import {
  epochDay, isAfter, isBefore, javaEqualsIgnoreCase, javaIsBlank, javaTrim, plusDays, type LocalDate,
} from '../../../../lib/javaCompat';
import { currentTerm } from '../../../commission/logic/commissionTerms';
import type { Commission } from '../../../commission/logic/types';

export const LOOKAHEAD_DAYS = 14;
export const PLANNING_LEAD_DAYS = 60;
export const ANY = 'any';

/** One `selectedCourses[]` entry of a saved schedule payload. */
export interface Pick { subjectCode: string; commissionNames: string[] }

/** commissionName is set (and commissions are the user's) only when the schedule names exactly one. */
export interface CurrentSubject<C extends Commission = Commission> {
  subjectCode: string;
  commissionName: string | null;
  commissions: C[];
}

export interface Resolution<C extends Commission = Commission> { current: boolean; subjects: CurrentSubject<C>[] }

const STALE = (): Resolution<never> => ({ current: false, subjects: [] });

/**
 * The scheduler's payload v1: {selectedCourses: [{subject_id, selectedCommissions: [names]}]}.
 * Anything malformed is skipped. `payload` is the parsed JSONB.
 */
export function parsePayload(payload: unknown): Pick[] {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const courses = (payload as Record<string, unknown>).selectedCourses;
  if (!Array.isArray(courses)) return [];
  const out: Pick[] = [];
  for (const o of courses) {
    if (o == null || typeof o !== 'object' || Array.isArray(o)) continue;
    const m = o as Record<string, unknown>;
    const code = m.subject_id;
    if (typeof code !== 'string' || javaIsBlank(code)) continue;
    const names: string[] = [];
    if (Array.isArray(m.selectedCommissions)) {
      for (const n of m.selectedCommissions) if (typeof n === 'string') names.push(n);
    }
    out.push({ subjectCode: javaTrim(code), commissionNames: names });
  }
  return out;
}

/** Commissions of ONE subject (any terms) -> those of its current term. */
export function currentTermOf<C extends Commission>(subjectCommissions: readonly C[], today: LocalDate): C[] {
  const startsBy = plusDays(today, LOOKAHEAD_DAYS);
  const candidates = subjectCommissions.filter((c) => !isBefore(c.courseEnd, today) && !isAfter(c.courseStart, startsBy));
  return currentTerm(candidates, today);
}

/** Commissions of many subjects -> per subject code its current term (subjects without one are left out). */
export function currentTermBySubject<C extends Commission>(commissions: Iterable<C>, today: LocalDate): Map<string, C[]> {
  const bySubject = new Map<string, C[]>();
  for (const c of commissions) {
    let list = bySubject.get(c.subjectCode);
    if (!list) bySubject.set(c.subjectCode, (list = []));
    list.push(c);
  }
  const out = new Map<string, C[]>();
  for (const [code, list] of bySubject) {
    const term = currentTermOf(list, today);
    if (term.length > 0) out.set(code, term);
  }
  return out;
}

export function resolve<C extends Commission>(picks: readonly Pick[], savedOn: LocalDate | null,
                                              currentBySubject: ReadonlyMap<string, C[]>): Resolution<C> {
  const subjects: CurrentSubject<C>[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    if (seen.has(pick.subjectCode)) continue;
    seen.add(pick.subjectCode);
    const term = currentBySubject.get(pick.subjectCode) ?? [];
    if (term.length === 0) continue;
    const names = [...new Set(pick.commissionNames.map(javaTrim)
      .filter((n) => n.length > 0 && !javaEqualsIgnoreCase(n, ANY)))];
    if (names.length === 0) {
      subjects.push({ subjectCode: pick.subjectCode, commissionName: null, commissions: term });
      continue;
    }
    const matched = term.filter((c) => names.includes(c.commissionName));
    if (matched.length === 0) continue;
    subjects.push({ subjectCode: pick.subjectCode, commissionName: names.length === 1 ? names[0]! : null, commissions: matched });
  }
  if (subjects.length === 0 || savedOn == null) return STALE();
  const latestStart = Math.max(...subjects.flatMap((s) => s.commissions.map((c) => epochDay(c.courseStart))));
  if (epochDay(savedOn) < latestStart - PLANNING_LEAD_DAYS) return STALE();
  return { current: true, subjects: [...subjects] };
}

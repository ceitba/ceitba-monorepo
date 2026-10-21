// Port of apps/api/src/main/java/org/ceitba/api/service/commission/CommissionTerms.java.
//
// Picks which synced commissions of a subject are "the term to show" (shared by
// GET /v1/subjects and GET /v1/commissions). The commission table keeps every
// term ever synced, so a term is identified by course dates:
//   1. Candidates: commissions that have not ended (course_end >= today); if
//      none, every commission (fallback to the most recent term).
//   2. Keep the NEWEST term: with N the latest course_start among candidates,
//      a candidate belongs to it when (a) its course_start is within
//      TERM_WINDOW_DAYS of N (inclusive) or (b) its course_end >= N.
// See the Java class for the reasoning behind the 60-day window.

import { epochDay, isBefore, ofEpochDay, plusDays, type LocalDate } from '../../../lib/javaCompat';
import type { Commission } from './types';

export const TERM_WINDOW_DAYS = 60;

/** One subject's commissions -> the ones of the term to show, preserving the input order. */
export function currentTerm<C extends Commission>(commissions: readonly C[], today: LocalDate): C[] {
  if (commissions.length === 0) return [...commissions];
  const notEnded = commissions.filter((c) => !isBefore(c.courseEnd, today));
  return newestTerm(notEnded.length === 0 ? commissions : notEnded);
}

/** Whether currentTerm fell back to an ended term for these (already selected) commissions. */
export function isPastTerm(selected: readonly Commission[], today: LocalDate): boolean {
  return selected.length > 0 && selected.every((c) => isBefore(c.courseEnd, today));
}

/** Commissions of any number of subjects -> per subject code (first appearance order) its term to show. */
export function currentTermBySubject<C extends Commission>(commissions: Iterable<C>, today: LocalDate): Map<string, C[]> {
  const bySubject = new Map<string, C[]>();
  for (const c of commissions) {
    let list = bySubject.get(c.subjectCode);
    if (!list) bySubject.set(c.subjectCode, (list = []));
    list.push(c);
  }
  for (const [code, list] of bySubject) bySubject.set(code, currentTerm(list, today));
  return bySubject;
}

function newestTerm<C extends Commission>(candidates: readonly C[]): C[] {
  const newestStart = candidates.reduce((max, c) => Math.max(max, epochDay(c.courseStart)), -Infinity);
  const termFrom = epochDay(plusDays(ofEpochDay(newestStart), -TERM_WINDOW_DAYS));
  return candidates.filter((c) => !(epochDay(c.courseStart) < termFrom)   // (a) starts within the window
    || !(epochDay(c.courseEnd) < newestStart));                            // (b) still running at newestStart
}

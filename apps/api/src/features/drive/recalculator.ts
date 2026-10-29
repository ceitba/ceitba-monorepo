// service/drive/DriveRecalculator: recomputes the derived columns of every
// file of a source in memory (the session flushes them):
//   effective_subject_id  own subject, else the nearest ancestor's, else the source's
//   suggested_subject_id  SubjectMatcher on the name (the owner's plan first), only
//                         without an effective subject and only where it differs
//                         from the suggestion inherited from its folders
//   academic_year(_source) USER > INHERITED > NAME > DRIVE
//   publication           PublicationRule (published_at set on each move into PUBLISHED)
// A file that was PUBLISHED and no longer is (or now counts for another
// subject) takes down the wiki pages citing it.

import { sql } from 'drizzle-orm';
import type { Clock } from '../../infra/clock';
import { yearInZone } from '../../lib/time';
import type { KbTakedown } from './kbHooks';
import { academicYearFromName } from './logic/academicYears';
import { decidePublication } from './logic/publicationRule';
import { SubjectMatcher } from './logic/subjectMatcher';
import { isApproved, isLive, isRemovedFromDrive, setAcademicYear, type DriveFile, type DriveSource } from './model';
import type { Session } from './session';


/** Subject ids of the user's plan in plan order (year, semester, id); [] without a plan. */
export async function planSubjectIds(s: Session, userId: string | null): Promise<string[]> {
  if (userId == null) return [];
  const [u] = await s.rows(sql`SELECT plan FROM public."user" WHERE id = ${userId}`);
  const plan = (u?.plan as string | null) ?? null;
  if (plan == null || plan.trim() === '') return [];
  // A subject in several sections keeps its first entry (plan order).
  const rows = await s.rows(sql`SELECT DISTINCT ON (subject_id) subject_id, COALESCE(year, 0) AS year, COALESCE(semester, 0) AS semester
    FROM public.plan_entry_effective WHERE plan_id = ${plan} ORDER BY subject_id, position`);
  return rows
    .map((r) => ({ id: r.subject_id as string, year: Number(r.year), semester: Number(r.semester) }))
    .sort((a, b) => a.year - b.year || a.semester - b.semester || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
}

export async function matcher(s: Session, plan: string[]): Promise<SubjectMatcher> {
  const subjects = new Map<string, string>();
  for (const r of await s.rows(sql`SELECT id, name FROM public.subject`)) if (!subjects.has(r.id as string)) subjects.set(r.id as string, r.name as string);
  return new SubjectMatcher(subjects, plan);
}

/** Depth of each item below the root (direct children: 0). */
export function depth(f: DriveFile, byDriveId: Map<string, DriveFile>): number {
  let d = 0;
  const seen = new Set<string>();
  let cur: DriveFile = f;
  while (cur.parentDriveId != null && !seen.has(cur.driveId)) {
    seen.add(cur.driveId);
    const next = byDriveId.get(cur.parentDriveId);
    if (!next) break;
    cur = next;
    d++;
  }
  return d;
}

const parentOf = (f: DriveFile, by: Map<string, DriveFile>) => (f.parentDriveId == null ? undefined : by.get(f.parentDriveId));

/** USER (own) > INHERITED (an ancestor's USER) > NAME (own name, else nearest folder name) > DRIVE (min(created, modified) in ART). */
export function academicYear(f: DriveFile, by: Map<string, DriveFile>, currentYear: number): void {
  if (f.academicYearUser != null) {
    setAcademicYear(f, f.academicYearUser, 'USER');
    return;
  }
  const seen = new Set<string>([f.driveId]);
  for (let p = parentOf(f, by); p && !seen.has(p.driveId); p = parentOf(p, by)) {
    seen.add(p.driveId);
    if (p.academicYearUser != null) {
      setAcademicYear(f, p.academicYearUser, 'INHERITED');
      return;
    }
  }
  seen.clear();
  for (let cur: DriveFile | undefined = f; cur && !seen.has(cur.driveId); cur = parentOf(cur, by)) {
    seen.add(cur.driveId);
    const y = academicYearFromName(cur.name, currentYear);
    if (y != null) {
      setAcademicYear(f, y, 'NAME');
      return;
    }
  }
  let first = f.driveCreatedAt;
  const modified = f.driveModifiedAt;
  if (first == null || (modified != null && modified < first)) first = modified;
  setAcademicYear(f, first == null ? null : yearInZone(first), 'DRIVE');
}

export class DriveRecalculator {
  constructor(private readonly clock: Clock, private readonly kb: KbTakedown) {}

  async recompute(s: Session, source: DriveSource, files: DriveFile[], m?: SubjectMatcher): Promise<void> {
    const subjectMatcher = m ?? (await matcher(s, await planSubjectIds(s, source.userId)));
    const now = this.clock.now();
    const currentYear = yearInZone(now);
    const byDriveId = new Map<string, DriveFile>();
    for (const f of files) byDriveId.set(f.driveId, f);
    // Top-down (stable sort), so each item sees its folders' suggestions.
    const ordered = files.map((f) => ({ f, d: depth(f, byDriveId) })).sort((a, b) => a.d - b.d).map((x) => x.f);
    const suggestionBelow = new Map<string, string | null>();
    const takenDown: string[] = [];
    for (const f of ordered) {
      const wasPublished = f.publication === 'PUBLISHED';
      const publishedSubject = f.effectiveSubjectId;
      let effective: string | null = null;
      let hidden = false;
      const seen = new Set<string>();
      for (let cur: DriveFile | undefined = f; cur && !seen.has(cur.driveId); cur = parentOf(cur, byDriveId)) {
        seen.add(cur.driveId);
        if (effective == null && cur.subjectId != null) effective = cur.subjectId;
        if (cur.hidden) hidden = true;
      }
      if (effective == null) effective = source.subjectId;
      f.effectiveSubjectId = effective;
      academicYear(f, byDriveId, currentYear);

      const inherited = f.parentDriveId == null ? null : (suggestionBelow.get(f.parentDriveId) ?? null);
      let suggested: string | null = null;
      if (effective == null && !isRemovedFromDrive(f)) {
        const own = subjectMatcher.match(f.name);
        if (own != null && own !== inherited) suggested = own;
      }
      f.suggestedSubjectId = suggested;
      suggestionBelow.set(f.driveId, effective != null ? null : (suggested ?? inherited));

      const publication = decidePublication({
        kind: f.kind, removedFromDrive: isRemovedFromDrive(f), staffDecision: f.staffDecision, hasEffectiveSubject: effective != null,
        effectivelyHidden: hidden, sourceLive: isLive(source), sourceApproved: isApproved(source), ownedBySharer: f.ownedBySharer,
        reportCount: f.reportCount,
      });
      if (publication === 'PUBLISHED' && f.publication !== 'PUBLISHED') f.publishedAt = now;
      f.publication = publication;
      if (wasPublished && (publication !== 'PUBLISHED' || publishedSubject !== effective)) takenDown.push(f.id);
    }
    if (takenDown.length) await this.kb.hidePagesCiting(s, takenDown);
  }
}

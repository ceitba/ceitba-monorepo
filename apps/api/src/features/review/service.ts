// Subject reviews (docs/SUBJECT-REVIEWS.md). Reviews are anonymous to readers:
// no response carries the author; `mine` is the only link to the caller.
// Timestamps are always read back from the database (UTC, `...Z`).

import type { Deps } from '../../deps';
import { isUniqueViolation, withTx, type Tx } from '../../db/client';
import { FakeProfessorDirectory, GooglePeopleDirectory, type ProfessorDirectory } from '../../external/googleDirectory';
import { ResourceNotFoundError } from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { formatOffsetDateTime, parsePgTimestamp, systemNowMicros } from '../../lib/time';
import { mailBeans } from '../mail/service';
import type {
  ProfessorResponse, ReportReviewRequest, ReviewReportReason, ReviewResponse, SaveReviewRequest, StaffReviewResponse,
  SubjectReviewsResponse,
} from './dto';
import { ReviewError } from './errors';
import * as repo from './repo';

/** Like Apuntes: this many reports hide a review until staff restores it. */
export const HIDE_AT_REPORTS = 3;

const ts = (pg: string) => formatOffsetDateTime(parsePgTimestamp(pg));
const blankToNull = (s: string | null | undefined): string | null => (s == null || javaIsBlank(s) ? null : javaTrim(s));

/** The term "today" falls in: first semester through July, second from August. */
export function currentTerm(today: string): { year: number; period: number } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return { year: y, period: m <= 7 ? 1 : 2 };
}

export class SubjectReviewService {
  private readonly directory: ProfessorDirectory;

  constructor(private readonly deps: Deps, directory?: ProfessorDirectory) {
    this.directory = directory ?? (deps.config.reviews.directoryUseFake
      ? new FakeProfessorDirectory()
      : new GooglePeopleDirectory(async () => {
        const mail = mailBeans(deps);
        const creds = await mail.accounts.directoryCredentials();
        return creds == null ? null : mail.tokens.get(creds);
      }));
  }

  list(subjectId: string, viewerId: string): Promise<SubjectReviewsResponse> {
    return withTx(this.deps.db, async (tx) => {
      const name = await repo.subjectName(tx, subjectId);
      if (name == null) throw new ResourceNotFoundError('Subject', subjectId);
      const rows = await repo.forSubject(tx, subjectId, viewerId);
      const views = await this.views(tx, rows, viewerId);
      const ids = [...new Set(views.flatMap((v) => v.professorIds))];
      return { subjectId, subjectName: name, reviews: views, professors: (await repo.professorsByIds(tx, ids)).map(professorView) };
    }, { readOnly: true });
  }

  async create(subjectId: string, userId: string, req: SaveReviewRequest): Promise<ReviewResponse> {
    this.deps.userRateLimiter.consume('subject-reviews', userId);
    const values = this.values(req);
    const id = crypto.randomUUID();
    return this.saving(() => withTx(this.deps.db, async (tx) => {
      if ((await repo.subjectName(tx, subjectId)) == null) throw new ResourceNotFoundError('Subject', subjectId);
      await repo.insertReview(tx, id, subjectId, userId, values, systemNowMicros());
      await repo.setProfessors(tx, id, await this.knownProfessors(tx, req.professorIds));
      return this.view(tx, id, userId);
    }));
  }

  async update(id: string, userId: string, req: SaveReviewRequest): Promise<ReviewResponse> {
    this.deps.userRateLimiter.consume('subject-reviews', userId);
    const values = this.values(req);
    return this.saving(() => withTx(this.deps.db, async (tx) => {
      await this.own(tx, id, userId);
      await repo.updateReview(tx, id, values, systemNowMicros());
      await repo.setProfessors(tx, id, await this.knownProfessors(tx, req.professorIds));
      return this.view(tx, id, userId);
    }));
  }

  delete(id: string, userId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      // Deleting a hidden review would free the term for a fresh copy with no reports.
      if ((await this.own(tx, id, userId)).hidden) throw new ReviewError('HIDDEN', 'This review is hidden by reports until staff reviews it');
      await repo.deleteReview(tx, id);
    });
  }

  setHelpful(id: string, userId: string, on: boolean): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const r = await this.visible(tx, id, userId, true);
      if (r.userId === userId) throw new ReviewError('OWN_REVIEW', 'You cannot mark your own review as helpful');
      if (on) await repo.addHelpful(tx, id, userId, systemNowMicros());
      else await repo.removeHelpful(tx, id, userId);
    });
  }

  report(id: string, userId: string, req: ReportReviewRequest): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      // Locked: concurrent reports recount one after the other, so the third always hides it.
      const r = await this.visible(tx, id, userId, true);
      if (r.userId === userId) throw new ReviewError('OWN_REVIEW', 'You cannot report your own review');
      const now = systemNowMicros();
      await repo.upsertReport(tx, id, userId, req.reason!, blankToNull(req.comment), now);
      await repo.recountReports(tx, id, HIDE_AT_REPORTS, now);
    });
  }

  /**
   * The professor with this ITBA address, named from the Google directory the
   * first time someone adds them. The email itself is never returned.
   */
  async lookupProfessor(userId: string, rawEmail: string): Promise<ProfessorResponse> {
    const email = javaTrim(rawEmail).toLowerCase();
    const domains = this.deps.config.auth.allowedDomains.map((d) => d.toLowerCase());
    if (!domains.some((d) => email.endsWith(`@${d}`))) {
      throw new ReviewError('PROFESSOR_EMAIL_DOMAIN', `The professor's address must be @${domains.join(', @')}`);
    }
    const known = await withTx(this.deps.db, (tx) => repo.professorByEmail(tx, email), { readOnly: true });
    if (known) return professorView(known);
    this.deps.userRateLimiter.consume('professor-lookups', userId);
    let person;
    try {
      person = await this.directory.findByEmail(email);
    } catch (e) {
      this.deps.log.warn({ err: e }, 'Subject reviews: professor directory lookup failed');
      throw new ReviewError('DIRECTORY_UNAVAILABLE', 'The ITBA directory cannot be reached right now');
    }
    if (person == null) throw new ReviewError('PROFESSOR_NOT_FOUND', 'No one in the ITBA directory has that address');
    const name = [...person.name].slice(0, 255).join(''); // professor.name is VARCHAR(255)
    return professorView(await withTx(this.deps.db, (tx) => repo.upsertProfessor(tx, email, name, systemNowMicros())));
  }

  staffHidden(): Promise<StaffReviewResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const rows = await repo.hidden(tx);
      const ids = rows.map((r) => r.id);
      const [profIds, reports, names] = [await repo.professorIdsOf(tx, ids), await repo.reportsOf(tx, ids), await repo.subjectNames(tx, rows.map((r) => r.subjectId))];
      const profs = new Map((await repo.professorsByIds(tx, [...new Set([...profIds.values()].flat())])).map((p) => [p.id, professorView(p)]));
      return rows.map((r) => ({
        id: r.id, subjectId: r.subjectId, subjectName: names.get(r.subjectId) ?? r.subjectId, year: r.year, period: r.period,
        commission: r.commission, professors: (profIds.get(r.id) ?? []).map((p) => profs.get(p)!), recommend: r.recommend,
        difficulty: r.difficulty, comment: r.comment, reportCount: r.reportCount,
        reports: (reports.get(r.id) ?? []).map((x) => ({ reason: x.reason as ReviewReportReason, comment: x.comment, createdAt: ts(x.createdAt) })),
        createdAt: ts(r.createdAt), updatedAt: ts(r.updatedAt),
      }));
    }, { readOnly: true });
  }

  staffRestore(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if ((await repo.findByIdForUpdate(tx, id)) == null) throw new ResourceNotFoundError('SubjectReview', id);
      await repo.restore(tx, id);
    });
  }

  staffDelete(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if ((await repo.findByIdForUpdate(tx, id)) == null) throw new ResourceNotFoundError('SubjectReview', id);
      await repo.deleteReview(tx, id);
    });
  }

  /**
   * Account deletion's step, inside its transaction `tx`: the user's reviews, votes and reports, recounting the
   * reports of the reviews they reported (repo.deleteUserData).
   */
  deleteUserDataIn(tx: Tx, userId: string): Promise<void> {
    return repo.deleteUserData(tx, userId);
  }

  // ------------------------------------------------------------ helpers

  private values(req: SaveReviewRequest): repo.ReviewValues {
    const now = currentTerm(this.deps.clock.today());
    if (req.year! > now.year || (req.year === now.year && req.period! > now.period)) {
      throw new ReviewError('FUTURE_TERM', 'You can only review a term that already started');
    }
    return {
      year: req.year!, period: req.period!, commission: javaTrim(req.commission!), recommend: req.recommend!,
      difficulty: req.difficulty!, comment: blankToNull(req.comment),
    };
  }

  /** The (deduplicated) ids, all of them existing professors. */
  private async knownProfessors(tx: Tx, ids: (string | null)[] | null): Promise<string[]> {
    const wanted = [...new Set((ids ?? []).filter((x): x is string => x != null).map((x) => x.toLowerCase()))];
    const found = await repo.professorsByIds(tx, wanted);
    if (found.length !== wanted.length) throw new ReviewError('UNKNOWN_PROFESSOR', 'Add the professor by their ITBA address first');
    return wanted;
  }

  /** Another review of the same subject and term: 409 instead of the unique violation. */
  private async saving<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // The only unique key a review write can hit: subject_review_user_term_idx.
      if (isUniqueViolation(e)) {
        throw new ReviewError('ALREADY_REVIEWED', 'You already reviewed this subject for that term: edit that review instead');
      }
      throw e;
    }
  }

  /** The caller's own review (404 for anyone else's: authors stay anonymous). */
  private async own(tx: Tx, id: string, userId: string): Promise<repo.ReviewRow> {
    const r = await repo.findByIdForUpdate(tx, id);
    if (r == null || r.userId !== userId) throw new ResourceNotFoundError('SubjectReview', id);
    return r;
  }

  /** A review the caller can see: not hidden, or their own; `lock` takes the row lock (writes). */
  private async visible(tx: Tx, id: string, userId: string, lock = false): Promise<repo.ReviewRow> {
    const r = lock ? await repo.findByIdForUpdate(tx, id) : await repo.findById(tx, id);
    if (r == null || (r.hidden && r.userId !== userId)) throw new ResourceNotFoundError('SubjectReview', id);
    return r;
  }

  private async view(tx: Tx, id: string, viewerId: string): Promise<ReviewResponse> {
    return (await this.views(tx, [(await repo.findById(tx, id))!], viewerId))[0]!;
  }

  private async views(tx: Tx, rows: repo.ReviewRow[], viewerId: string): Promise<ReviewResponse[]> {
    const ids = rows.map((r) => r.id);
    const [profs, counts, mineHelpful, mineReported] = [
      await repo.professorIdsOf(tx, ids), await repo.helpfulCounts(tx, ids), await repo.helpfulBy(tx, viewerId, ids), await repo.reportedBy(tx, viewerId, ids),
    ];
    return rows.map((r) => ({
      id: r.id, year: r.year, period: r.period, commission: r.commission, professorIds: profs.get(r.id) ?? [],
      recommend: r.recommend, difficulty: r.difficulty, comment: r.comment, helpfulCount: counts.get(r.id) ?? 0,
      helpful: mineHelpful.has(r.id), reported: mineReported.has(r.id), mine: r.userId === viewerId, hidden: r.hidden,
      createdAt: ts(r.createdAt), updatedAt: ts(r.updatedAt),
    }));
  }
}

const professorView = (p: repo.ProfessorRow): ProfessorResponse => ({ id: p.id, name: p.name });

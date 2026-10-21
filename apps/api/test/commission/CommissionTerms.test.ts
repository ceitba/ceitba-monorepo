// Port of apps/api/src/test/java/org/ceitba/api/service/commission/CommissionTermsTest.java
import { describe, expect, test } from 'bun:test';
import { plusDays } from '../../src/lib/javaCompat';
import { currentTerm, currentTermBySubject, TERM_WINDOW_DAYS } from '../../src/features/commission/logic/commissionTerms';
import type { Commission } from '../../src/features/commission/logic/types';

const TODAY = '2026-10-02';

const c = (id: string, subject: string, start: string, end: string): Commission => ({
  id, subjectCode: subject, commissionName: 'A', courseStart: start, courseEnd: end, enrolledStudents: 0, quota: 0,
  subjectType: 'SEMESTRAL',
});
const ids = (list: Commission[]) => list.map((x) => x.id);

describe('CommissionTermsTest', () => {
  test('emptyStaysEmpty', () => {
    expect(currentTerm([], TODAY)).toEqual([]);
  });

  test('endedTermsAreDroppedWhileTheRunningTermHasCommissions', () => {
    const list = [
      c('s1-g', '31.08', '2026-03-01', '2026-07-25'),
      c('s2-g', '31.08', '2026-07-26', '2026-12-31'),
      c('s2-b', '31.08', '2026-07-26', '2026-12-31')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['s2-g', 's2-b']);
  });

  // The next term is synced before the current one ends: both are "not
  // ended", only the upcoming one is shown.
  test('nextTermSyncedEarlyReplacesTheRunningTerm', () => {
    const list = [
      c('now-g', '31.08', '2026-07-26', '2026-12-15'),
      c('now-b', '31.08', '2026-07-26', '2026-12-15'),
      c('next-g', '31.08', '2027-03-08', '2027-07-10'),
      c('next-b', '31.08', '2027-03-09', '2027-07-10')];
    expect(ids(currentTerm(list, '2026-12-01'))).toEqual(['next-g', 'next-b']);
  });

  // 81.74: two bimester modules of the same term, starts 42 days apart.
  test('concurrentOfferingsOfTheSameTermAreBothKept', () => {
    const list = [
      c('46512', '81.74', '2026-09-14', '2026-10-23'),
      c('47536', '81.74', '2026-10-26', '2026-11-30')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['46512', '47536']);
  });

  // A late module of the running term plus the next term synced early: only
  // the next term (the module starts > 60 days before it).
  test('lateModuleOfTheRunningTermIsNotMistakenForTheNextTerm', () => {
    const list = [
      c('mod2', '81.74', '2026-10-26', '2026-11-30'),
      c('next', '81.74', '2027-03-08', '2027-05-01')];
    expect(ids(currentTerm(list, '2026-11-10'))).toEqual(['next']);
  });

  // 72.45 in prod: a year-long commission (started 147 days before the
  // second-semester ones) is still running and must stay beside them.
  test('yearLongCommissionRunningAlongsideTheSecondSemesterIsKept', () => {
    const list = [
      c('s1', '72.45', '2026-03-01', '2026-07-25'),
      c('year', '72.45', '2026-03-01', '2026-12-31'),
      c('s2-a', '72.45', '2026-07-26', '2026-12-31'),
      c('s2-b', '72.45', '2026-07-26', '2026-12-31')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['year', 's2-a', 's2-b']);
  });

  // Same, in the fallback (everything ended): the year-long commission is
  // part of the most recent term, the first semester is not.
  test('yearLongCommissionIsKeptInTheFallbackToo', () => {
    const list = [
      c('s1', '72.45', '2026-03-01', '2026-07-25'),
      c('year', '72.45', '2026-03-01', '2026-12-31'),
      c('s2', '72.45', '2026-07-26', '2026-12-31')];
    expect(ids(currentTerm(list, '2027-01-15'))).toEqual(['year', 's2']);
  });

  // A commission running 26/07/2026-27/06/2027 stays next to the March 2027
  // term once it is synced, while the December-ending ones drop.
  test('crossYearCommissionStaysWhenTheNextTermIsSynced', () => {
    const list = [
      c('s2', 'x', '2026-07-26', '2026-12-31'),
      c('long', 'x', '2026-07-26', '2027-06-27')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['s2', 'long']);

    const withNext = [list[0]!, list[1]!, c('next', 'x', '2027-03-01', '2027-07-10')];
    expect(ids(currentTerm(withNext, '2026-12-10'))).toEqual(['long', 'next']);
  });

  // Current term ends 31/12, next one (synced early) starts 01/03: they
  // do not overlap, so only the next term is shown.
  test('decemberTermDoesNotOverlapTheNextMarchTerm', () => {
    const list = [
      c('now', 'x', '2026-07-26', '2026-12-31'),
      c('next', 'x', '2027-03-01', '2027-07-25')];
    expect(ids(currentTerm(list, '2026-12-01'))).toEqual(['next']);
  });

  // First semester ends 25/07 and the second starts 26/07: during the last
  // days of the first semester only the second is shown.
  test('firstSemesterEndingTheDayBeforeTheSecondStartsIsDropped', () => {
    const list = [
      c('s1', 'x', '2026-03-01', '2026-07-25'),
      c('s2', 'x', '2026-07-26', '2026-12-31')];
    expect(ids(currentTerm(list, '2026-07-20'))).toEqual(['s2']);
  });

  // Rule (b) is inclusive: ending on the newest start day counts as running.
  test('endingOnTheNewestStartIsKept', () => {
    const list = [
      c('old', 'x', '2026-03-01', '2026-07-26'),
      c('new', 'x', '2026-07-26', '2026-12-31')];
    expect(ids(currentTerm(list, '2026-07-20'))).toEqual(['old', 'new']);
  });

  test('windowBoundaryIsInclusive', () => {
    const newest = '2027-03-08';
    const list = [
      // Both end before the newest start, so only the window decides.
      c('edge', 'x', plusDays(newest, -TERM_WINDOW_DAYS), plusDays(newest, -1)),
      c('out', 'x', plusDays(newest, -(TERM_WINDOW_DAYS + 1)), plusDays(newest, -1)),
      c('newest', 'x', newest, '2027-07-01')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['edge', 'newest']);
  });

  test('endsTodayIsNotEnded', () => {
    const list = [
      c('today', 'x', '2026-03-01', TODAY),
      c('past', 'x', '2025-08-01', '2025-12-01')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['today']);
  });

  // Nothing running: the most recent term, including all of its parallel
  // offerings, instead of an empty subject.
  test('fallsBackToTheMostRecentTermWhenEverythingEnded', () => {
    const list = [
      c('2025', '72.99', '2025-03-01', '2025-07-25'),
      c('mod1', '72.99', '2026-03-02', '2026-05-01'),
      c('mod2', '72.99', '2026-04-27', '2026-07-01')];
    expect(ids(currentTerm(list, TODAY))).toEqual(['mod1', 'mod2']);
  });

  test('bySubjectSelectsPerSubjectAndKeepsOrder', () => {
    const list = [
      c('a-old', 'A', '2026-03-01', '2026-07-25'),
      c('a-now', 'A', '2026-07-26', '2026-12-15'),
      c('b-now', 'B', '2026-07-26', '2026-12-15'),
      c('b-next', 'B', '2027-03-08', '2027-07-10')];
    const bySubject = currentTermBySubject(list, TODAY);
    expect([...bySubject.keys()]).toEqual(['A', 'B']);
    expect(ids(bySubject.get('A')!)).toEqual(['a-now']);
    expect(ids(bySubject.get('B')!)).toEqual(['b-next']);
  });
});

// Port of apps/api/src/test/java/org/ceitba/api/service/digest/personal/DigestTermTest.java
import { describe, expect, test } from 'bun:test';
import type { Commission } from '../../../src/features/commission/logic/types';
import {
  currentTermBySubject, currentTermOf, parsePayload, resolve, type Pick,
} from '../../../src/features/digest/logic/personal/digestTerm';

// Second semester 2026 running (starts 2026-08-03, ends 2026-12-05).
const TODAY = '2026-10-05';

const c = (id: string, subject: string, name: string, start: string, end: string): Commission =>
  ({ id, subjectCode: subject, commissionName: name, courseStart: start, courseEnd: end, enrolledStudents: 0, quota: 30, subjectType: 'SEMESTRAL' });

const FIS_1C_A = c('1', '93.41', 'A', '2026-03-09', '2026-07-11');
const FIS_2C_A = c('2', '93.41', 'A', '2026-08-03', '2026-12-05');
const FIS_2C_B = c('3', '93.41', 'B', '2026-08-03', '2026-12-05');
const MAT_2C_A = c('4', '93.58', 'A', '2026-08-03', '2026-12-05');
const ANNUAL = c('5', '72.45', 'A', '2026-03-02', '2026-12-15');
// Next March's term already synced: not "current" for the digest.
const FIS_NEXT_A = c('6', '93.41', 'A', '2027-03-08', '2027-07-10');

const current = (...all: Commission[]) => currentTermBySubject(all, TODAY);
const pick = (subjectCode: string, commissionNames: string[]): Pick => ({ subjectCode, commissionNames });

describe('DigestTermTest', () => {
  test('currentTermIsTheRunningOneNotPastOrFarFutureTerms', () => {
    const cur = current(FIS_1C_A, FIS_2C_A, FIS_2C_B, FIS_NEXT_A, MAT_2C_A);
    expect(cur.get('93.41')).toEqual([FIS_2C_A, FIS_2C_B]);
    expect(cur.get('93.58')).toEqual([MAT_2C_A]);
  });

  test('aTermStartingWithinTwoWeeksCountsAndBetweenTermsThereIsNone', () => {
    const aug = c('7', '93.41', 'A', '2026-08-03', '2026-12-05');
    expect(currentTermOf([aug], '2026-07-22')).toEqual([aug]);
    expect(currentTermOf([aug], '2026-07-15')).toEqual([]);
    expect(currentTermOf([FIS_1C_A, FIS_2C_A], '2027-01-10')).toEqual([]);
  });

  test('scheduleSavedForThisTermIsCurrent', () => {
    const picks = [pick('93.41', ['A']), pick('93.58', ['any'])];
    const r = resolve(picks, '2026-07-20', current(FIS_1C_A, FIS_2C_A, FIS_2C_B, MAT_2C_A));
    expect(r.current).toBe(true);
    expect(r.subjects.map((s) => s.subjectCode)).toEqual(['93.41', '93.58']);
    // Exactly one named commission = the user's; "any" = unknown.
    expect(r.subjects[0]!.commissionName).toBe('A');
    expect(r.subjects[0]!.commissions).toEqual([FIS_2C_A]);
    expect(r.subjects[1]!.commissionName).toBeNull();
  });

  test('scheduleSavedForThePreviousTermIsStaleEvenWithTheSameCommissionNames', () => {
    const picks = [pick('93.41', ['A'])];
    // Saved in February for the first semester; "A" exists again now.
    const r = resolve(picks, '2026-02-20', current(FIS_1C_A, FIS_2C_A));
    expect(r.current).toBe(false);
    expect(r.subjects).toEqual([]);
    // Just inside the planning lead (60 days before 2026-08-03).
    expect(resolve(picks, '2026-06-04', current(FIS_2C_A)).current).toBe(true);
    expect(resolve(picks, '2026-06-03', current(FIS_2C_A)).current).toBe(false);
  });

  test('yearLongSubjectsDoNotMakeAnOldScheduleCurrent', () => {
    const picks = [pick('72.45', ['A']), pick('93.41', ['A'])];
    const cur = current(ANNUAL, FIS_2C_A);
    expect(resolve(picks, '2026-02-20', cur).current).toBe(false);
    expect(resolve(picks, '2026-07-25', cur).current).toBe(true);
  });

  test('unknownSubjectsOrCommissionsAreDroppedAndNothingLeftIsStale', () => {
    const cur = current(FIS_2C_A, MAT_2C_A);
    const r = resolve([
      pick('93.41', ['Z']), // not offered this term
      pick('99.99', ['A']), // no current commission
      pick('93.58', ['A', 'B'])], // two names: no own commission
    TODAY, cur);
    expect(r.current).toBe(true);
    expect(r.subjects).toHaveLength(1);
    expect(r.subjects[0]!.subjectCode).toBe('93.58');
    expect(r.subjects[0]!.commissionName).toBeNull();
    expect(resolve([pick('93.41', ['Z'])], TODAY, cur).current).toBe(false);
    expect(resolve([], TODAY, cur).current).toBe(false);
  });

  test('parsesTheSchedulerPayloadAndSkipsJunk', () => {
    const payload = {
      version: 1, selectedCourses: [
        { subject_id: '93.41', selectedCommissions: ['A', 3] },
        { subject_id: '' },
        'junk',
        { subject_id: '93.58' }],
    };
    expect(parsePayload(payload)).toEqual([pick('93.41', ['A']), pick('93.58', [])]);
    expect(parsePayload({})).toEqual([]);
    expect(parsePayload(null)).toEqual([]);
  });
});

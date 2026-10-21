// Port of apps/api/src/test/java/org/ceitba/api/service/digest/DigestSelectionTest.java
import { describe, expect, test } from 'bun:test';
import { isSharedEmpty, type DigestArticle, type DigestCandidates, type DigestEvent, type DigestOrg } from '../../src/features/digest/logic/digestContent';
import { digestIncluded } from '../../src/features/digest/logic/digestSelection';
import { DigestWeek } from '../../src/features/digest/logic/digestWeek';

const CEITBA: DigestOrg = { slug: 'ceitba', name: 'CEITBA' };
const SABF: DigestOrg = { slug: 'sabf', name: 'SABF' };
const WEEK = new DigestWeek('2026-09-28');

const article = (id: string, org: DigestOrg | null): DigestArticle =>
  ({ id, title: `T ${id}`, excerpt: 'E', coverImage: null, publishedAt: '2026-09-30', organization: org });
const event = (id: string, org: DigestOrg | null): DigestEvent =>
  ({ id, title: `Ev ${id}`, eventDate: '2026-10-06', startTime: '18:00', endTime: '20:00', location: 'Aula 101', organization: org, signup: false });

const CANDIDATES: DigestCandidates = {
  week: WEEK,
  articles: [article('a-ceitba', CEITBA), article('a-sabf', SABF), article('a-indep', null)],
  events: [event('e-ceitba', CEITBA), event('e-sabf', SABF), event('e-none', null)],
};

describe('DigestSelectionTest', () => {
  test('everyOrgAndOrgLessItemIsIncludedByDefault', () => {
    const s = digestIncluded(CANDIDATES, [], []);
    expect(s.articles.map((a) => a.id)).toEqual(['a-ceitba', 'a-sabf', 'a-indep']);
    expect(s.events.map((e) => e.id)).toEqual(['e-ceitba', 'e-sabf', 'e-none']);
  });

  test('staffExclusionsApply', () => {
    const s = digestIncluded(CANDIDATES, ['a-indep', 'a-sabf'], ['e-ceitba']);
    expect(s.articles.map((a) => a.id)).toEqual(['a-ceitba']);
    expect(s.events.map((e) => e.id)).toEqual(['e-sabf', 'e-none']);
    expect(isSharedEmpty(s)).toBe(false);
  });

  test('everythingExcludedIsEmpty', () => {
    const s = digestIncluded(CANDIDATES, ['a-ceitba', 'a-sabf', 'a-indep'], ['e-ceitba', 'e-sabf', 'e-none']);
    expect(isSharedEmpty(s)).toBe(true);
  });
});

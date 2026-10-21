// Ports apps/api/src/test/java/org/ceitba/api/external/itba/ItbaWireFormatTest.java
// and CommissionQueryTest.java, plus the RestClientItbaApiClient mapping
// against a local gateway (the Java client is covered black-box by
// contract/tests/sync-data-sync and subject-organized).
import { afterAll, describe, expect, test } from 'bun:test';
import { DEFAULT_LEVELS, withDefaultsFilled } from '../../src/external/itba';
import { javaHashMapValues, javaParseInt, parseItbaDate, parseIsoLocalTime, RestItbaApiClient } from '../../src/external/itba/restClient';
import { readCareerPlans, readCourseCommissions, WireFormatError } from '../../src/external/itba/wire';
import { MutableClock } from '../../src/infra/clock';
import { ExternalApiError } from '../../src/http/errors';
import { localDateOf } from '../../src/lib/time';
import { MOCK_TOKEN, startMockItba } from './mockItba';

describe('ItbaWireFormatTest', () => {
  test('careerPlans_singleSection_singleTerm_singleEntry_singleDependency_allDeserialize', () => {
    const resp = readCareerPlans({ careerplan: { name: 'Sistemas', career: 'S', degreeLevel: 'UNDERGRAD', since: '2023', section: {
      name: 'Ciclo Básico', terms: { term: { year: '1', period: '1', entries: { entry: {
        type: 'subject', name: 'Algoritmos', code: '93.12', credits: '6', dependencies: { dependency: '93.11' } } } } } } } })!;
    expect(resp.careerPlan!.section!.length).toBe(1);
    const section = resp.careerPlan!.section![0]!;
    expect(section.terms!.term!.length).toBe(1);
    const term = section.terms!.term![0]!;
    expect(term.entries!.entry!.length).toBe(1);
    const entry = term.entries!.entry![0]!;
    expect(entry.code).toBe('93.12');
    expect(entry.dependencies!.dependency).toEqual(['93.11']);
  });

  test('careerPlans_arrayShapes_alsoDeserialize', () => {
    const resp = readCareerPlans({ careerplan: { name: 'Sistemas', career: 'S', degreeLevel: 'UNDERGRAD', since: '2023', section: [{
      name: 'Ciclo Básico', terms: { term: [{ year: '1', period: '1', entries: { entry: [
        { type: 'subject', name: 'Algoritmos', code: '93.12', credits: '6', dependencies: { dependency: ['93.11', '93.10'] } },
        { type: 'subject', name: 'Algoritmos II', code: '93.13', credits: '6' },
      ] } }] } }] } })!;
    const entries = resp.careerPlan!.section![0]!.terms!.term![0]!.entries!.entry!;
    expect(entries.length).toBe(2);
    expect(entries[0]!.dependencies!.dependency).toEqual(['93.11', '93.10']);
    expect(entries[1]!.dependencies).toBeNull();
  });

  test('careerPlans_withoutTermBranch_singleEntry', () => {
    const resp = readCareerPlans({ careerplan: { name: 'Sistemas', career: 'S', degreeLevel: 'UNDERGRAD', since: '2023', section: {
      name: 'Electivas', withoutTerm: { withoutTerm: { type: 'subject', name: 'Tópicos Avanzados', code: '93.99', credits: '4', creditsRequired: '120' } } } } })!;
    const section = resp.careerPlan!.section![0]!;
    expect(section.terms).toBeNull();
    expect(section.withoutTerm!.entries!.length).toBe(1);
    expect(section.withoutTerm!.entries![0]!.code).toBe('93.99');
    expect(section.withoutTerm!.entries![0]!.creditsRequired).toBe('120');
  });

  test('courseCommissions_singleCommission_singleTimeSlot', () => {
    const resp = readCourseCommissions({ courseCommissions: { courseCommission: {
      subjectCode: '93.12', subjectName: 'Algoritmos', subjectType: 'SEMESTRAL', courseStart: '21/07/25', courseEnd: '31/12/25',
      commissionName: 'A', commissionId: '93.12-A', quota: '30', enrolledStudents: '10',
      courseCommissionTimes: { day: 'MONDAY', classRoom: '102T', building: 'SDT', hourFrom: '14:00', hourTo: '17:00' } } } })!;
    expect(resp.courseCommissions!.courseCommission!.length).toBe(1);
    const c = resp.courseCommissions!.courseCommission![0]!;
    expect(c.commissionId).toBe('93.12-A');
    expect(c.courseCommissionTimes!.length).toBe(1);
    expect(c.courseCommissionTimes![0]!.day).toBe('MONDAY');
  });

  test('courseCommissions_unknownExtraFieldsIgnored', () => {
    const resp = readCourseCommissions({ courseCommissions: { courseCommission: {
      subjectCode: '93.12', subjectName: 'Algoritmos', subjectType: 'SEMESTRAL', courseStart: '21/07/25', courseEnd: '31/12/25',
      commissionName: 'A', commissionId: '93.12-A', quota: '30', enrolledStudents: '10', futureField: 'value', courseCommissionTimes: [] } } })!;
    expect(resp.courseCommissions!.courseCommission!.length).toBe(1);
  });

  // Beyond the Java test: Jackson coercions and rejections.
  test('scalarsCoerceToStringsAndWrongShapesFail', () => {
    const resp = readCareerPlans({ careerplan: { section: { name: 7, terms: { term: { year: 1, entries: { entry: { type: 'subject', credits: 6, code: true } } } } } } })!;
    const e = resp.careerPlan!.section![0]!.terms!.term![0]!.entries!.entry![0]!;
    expect([e.credits, e.code, resp.careerPlan!.section![0]!.name]).toEqual(['6', 'true', '7']);
    expect(() => readCareerPlans({ careerplan: { name: { x: 1 } } })).toThrow(WireFormatError);
    expect(() => readCareerPlans({ careerplan: { section: 'x' } })).toThrow(WireFormatError);
    expect(readCareerPlans(null)).toBeNull();
  });
});

describe('CommissionQueryTest', () => {
  test('defaults_useArgentinaDate_notUtc', () => {
    const today = new MutableClock('2026-01-01T01:00:00Z').today();
    const q = withDefaultsFilled({}, today);
    expect(q.year).toBe(2025);
    expect(q.period).toBe('SecondSemester');
    expect(q.levels).toEqual(DEFAULT_LEVELS);
  });

  test('defaults_firstSemester_betweenFebruaryAndJune', () => {
    const q = withDefaultsFilled({}, localDateOf(Date.parse('2026-03-15T12:00:00Z') * 1000));
    expect(q.year).toBe(2026);
    expect(q.period).toBe('FirstSemester');
  });

  test('explicitValues_areKept', () => {
    const q = withDefaultsFilled({ year: 2024, period: 'SecondSemester', levels: ['GRADUATE'] }, '2026-03-15');
    expect(q).toEqual({ year: 2024, period: 'SecondSemester', levels: ['GRADUATE'] });
  });
});

describe('RestClientItbaApiClient mapping', () => {
  const itba = startMockItba();
  afterAll(() => itba.stop());
  const client = new RestItbaApiClient({ baseUrl: `${itba.url}/`, token: MOCK_TOKEN, timeoutMs: 5000 }, new MutableClock('2026-10-20T15:00:00Z'));

  test('parsersFollowJava', () => {
    expect(parseItbaDate('21/07/25')).toBe('2025-07-21');
    expect(parseItbaDate('31/02/26')).toBe('2026-02-28');
    expect(() => parseItbaDate('2025-07-21')).toThrow();
    expect(parseIsoLocalTime('14:00')).toBe('14:00:00');
    expect(parseIsoLocalTime('10:30:15.500')).toBe('10:30:15.5');
    expect(() => parseIsoLocalTime('9:00')).toThrow();
    expect(javaParseInt('+6')).toBe(6);
    expect(() => javaParseInt(' 6')).toThrow();
    expect(() => javaParseInt('2147483648')).toThrow();
  });

  test('hashMapIterationOrder', () => {
    // String.hashCode buckets of "93.12-A|MONDAY|14:00" and "93.12-A|TUESDAY|09:00" (verified on the jar: TUESDAY first).
    expect(javaHashMapValues([['93.12-A|MONDAY|14:00', 'MON'], ['93.12-A|TUESDAY|09:00', 'TUE']])).toEqual(['TUE', 'MON']);
    expect(javaHashMapValues([['a', 1], ['a', 2]])).toEqual([1]);
  });

  test('commissionsSkipExcludedSubjectsAndNormalizeRooms', async () => {
    itba.reset();
    itba.stubCommissionsBody('UNDERGRADUATE', { courseCommissions: { courseCommission: [
      { subjectCode: '99.52', commissionId: 'x', courseStart: '01/01/26', courseEnd: '01/02/26', quota: '1', enrolledStudents: '1', courseCommissionTimes: [] },
      { subjectCode: '93.12', commissionId: 'no-times', courseStart: '01/01/26', courseEnd: '01/02/26', quota: '1', enrolledStudents: '1' },
      { subjectCode: '93.13', commissionId: 'C', subjectType: 'annual', commissionName: 'A', courseStart: '01/03/26', courseEnd: '01/07/26', quota: '5', enrolledStudents: '2',
        courseCommissionTimes: [{ day: 'friday', building: 'Sede Distrito Financiero', classRoom: '1', hourFrom: '08:00', hourTo: '10:00' }, { day: 'xx', hourFrom: '08:00', hourTo: '09:00' }] },
    ] } });
    const out = await client.getCommissions({});
    expect(out.map((c) => c.id)).toEqual(['C']);
    expect(out[0]!.subjectType).toBe('ANNUAL');
    expect(out[0]!.times).toContainEqual({ day: 'FRIDAY', classroom: '1', building: 'SDF', hourFrom: '08:00:00', hourTo: '10:00:00' });
    expect(out[0]!.times).toContainEqual({ day: 'MONDAY', classroom: 'Virtual Asincrónico', building: 'Online', hourFrom: '08:00:00', hourTo: '09:00:00' });
    expect(itba.requests).toEqual([`/courseCommissions/${MOCK_TOKEN}?level=GRADUATE&year=2026&period=SecondSemester`,
      `/courseCommissions/${MOCK_TOKEN}?level=UNDERGRADUATE&year=2026&period=SecondSemester`]);
  });

  test('errorsBecomeExternalApiError', async () => {
    itba.reset();
    itba.stubPlanBody('P', {}, 200);
    await expect(client.getSubjectsByPlan('P')).rejects.toBeInstanceOf(ExternalApiError);
    await expect(client.getSubjectsByPlan('P')).rejects.toThrow('External API error in ITBA during getSubjectsByPlan');
    const unconfigured = new RestItbaApiClient({ baseUrl: '', token: '', timeoutMs: 100 }, new MutableClock());
    await expect(unconfigured.getCommissions({ levels: ['GRADUATE'] })).rejects.toThrow('External API error in ITBA during getCommissions(level=GRADUATE)');
    itba.stubPlan('a b&c', []);
    await client.getSubjectsByPlan('a b&c').catch(() => {});
    expect(itba.requests.at(-1)).toBe(`/careerPlans/${MOCK_TOKEN}?plan=a%20b%26c`);
  });
});

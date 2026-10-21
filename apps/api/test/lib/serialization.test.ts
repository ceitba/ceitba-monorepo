// src/lib/time.ts + json.ts against outputs captured from the jar (Jackson
// 2.17 with Spring Boot's ObjectMapper, Hibernate 6 reads): docs/SERIALIZATION.md.
import { describe, expect, test } from 'bun:test';
import { bigDecimalString, javaDoubleString, javaFloat, toJavaJson } from '../../src/lib/json';
import { ART, formatInstant, formatLocalDateTime, formatOffsetDateTime, formatPgTime, parseIsoInstant, parsePgTimestamp } from '../../src/lib/time';

const us = (iso: string) => parseIsoInstant(iso)!;

describe('Instant (ISO_INSTANT: fraction in groups of 3)', () => {
  test.each([
    ['2026-01-02T03:04:05Z', '2026-01-02T03:04:05Z'],
    ['2026-01-02T03:04:05.500Z', '2026-01-02T03:04:05.500Z'],
    ['2026-01-02T03:04:05.120Z', '2026-01-02T03:04:05.120Z'],
    ['2026-01-02T03:04:05.123400Z', '2026-01-02T03:04:05.123400Z'],
    ['2026-01-02T03:04:00Z', '2026-01-02T03:04:00Z'],
    ['2026-10-20T22:40:05.348917Z', '2026-10-20T22:40:05.348917Z'],
  ])('%s', (input, expected) => expect(formatInstant(us(input))).toBe(expected));
});

describe('OffsetDateTime (ISO_OFFSET_DATE_TIME: trailing zeros stripped)', () => {
  test('from the database (UTC)', () => {
    // Values Hibernate read from TIMESTAMPTZ columns, as GET /v1/news/events/{id} printed them.
    expect(formatOffsetDateTime(parsePgTimestamp('2026-01-02 03:04:05.5+00'))).toBe('2026-01-02T03:04:05.5Z');
    expect(formatOffsetDateTime(parsePgTimestamp('2026-01-02 03:04:00+00'))).toBe('2026-01-02T03:04:00Z');
    expect(formatOffsetDateTime(parsePgTimestamp('2026-01-02 03:04:05.123456+00'))).toBe('2026-01-02T03:04:05.123456Z');
    expect(formatOffsetDateTime(parsePgTimestamp('2026-01-02 03:04:05.12+00'))).toBe('2026-01-02T03:04:05.12Z');
    expect(formatOffsetDateTime(parsePgTimestamp('2026-01-02 00:04:05.12-03'))).toBe('2026-01-02T03:04:05.12Z');
  });
  test('computed in the JVM zone (ART)', () => {
    expect(formatOffsetDateTime(us('2026-01-02T06:04:05.5Z'), ART)).toBe('2026-01-02T03:04:05.5-03:00');
    expect(formatOffsetDateTime(us('2026-01-02T06:04:00Z'), ART)).toBe('2026-01-02T03:04:00-03:00');
    expect(formatOffsetDateTime(us('2027-10-20T22:40:05.442228Z'), ART)).toBe('2027-10-20T19:40:05.442228-03:00');
  });
  test('LocalDateTime', () => {
    expect(formatLocalDateTime(us('2026-01-02T03:04:05.5Z'))).toBe('2026-01-02T03:04:05.5');
    expect(formatLocalDateTime(us('2026-01-02T03:04:00Z'))).toBe('2026-01-02T03:04:00');
  });
});

describe('LocalTime from a TIME column (java.sql.Time: milliseconds, truncated)', () => {
  test.each([
    ['09:00:00', '09:00:00'], ['18:30:15', '18:30:15'], ['09:00:00.123', '09:00:00.123'], ['18:30:15.5', '18:30:15.5'],
    ['00:00:00', '00:00:00'], ['23:59:59.999999', '23:59:59.999'], ['12:00:00.0001', '12:00:00'], ['09:00', '09:00:00'],
  ])('%s', (pg, expected) => expect(formatPgTime(pg)).toBe(expected));
});

describe('numbers', () => {
  test('Java double', () => {
    expect(javaDoubleString(1)).toBe('1.0');
    expect(javaDoubleString(0.1)).toBe('0.1');
    expect(javaDoubleString(1e20)).toBe('1.0E20');
    expect(javaDoubleString(1.5e-7)).toBe('1.5E-7');
    expect(javaDoubleString(1234567)).toBe('1234567.0');
    expect(javaDoubleString(12345678)).toBe('1.2345678E7');
    expect(javaDoubleString(0.001)).toBe('0.001');
    expect(javaDoubleString(90.585)).toBe('90.585');
  });
  test('Java float', () => {
    expect(JSON.stringify({ f: javaFloat(0.1) })).toBe('{"f":0.1}');
  });
  test('BigDecimal', () => {
    expect(bigDecimalString('5.00')).toBe('5.00');
    expect(bigDecimalString('1000')).toBe('1000');
    expect(bigDecimalString('0.0000001')).toBe('1E-7');
    expect(bigDecimalString('0.000001')).toBe('0.000001');
    expect(bigDecimalString('-0.50')).toBe('-0.50');
  });
});

describe('JSON text', () => {
  test('control characters use upper-case hex like Jackson', () => {
    expect(toJavaJson({ a: '\u001f' })).toBe('{"a":"\\u001F"}');
    expect(toJavaJson({ a: '\\u001f' })).toBe('{"a":"\\\\u001f"}');
    expect(toJavaJson({ a: 'ñ€' })).toBe('{"a":"ñ€"}');
  });
});

test('offsetDateTimeToString: OffsetDateTime.toString of a UTC value', async () => {
  const { offsetDateTimeToString } = await import('../../src/lib/time');
  const { parseIsoInstant } = await import('../../src/lib/time');
  expect(offsetDateTimeToString(parseIsoInstant('2026-01-02T03:04:00Z')!)).toBe('2026-01-02T03:04Z');
  expect(offsetDateTimeToString(parseIsoInstant('2026-01-02T03:04:05Z')!)).toBe('2026-01-02T03:04:05Z');
  expect(offsetDateTimeToString(parseIsoInstant('2026-01-02T03:04:05.5Z')!)).toBe('2026-01-02T03:04:05.500Z');
  expect(offsetDateTimeToString(parseIsoInstant('2026-01-02T03:04:00.000123Z')!)).toBe('2026-01-02T03:04:00.000123Z');
});

test('readJacksonTree keeps 5.0 and 5 apart (DoubleNode vs IntNode)', async () => {
  const { readJacksonTree, JDouble } = await import('../../src/lib/jackson');
  const { toJavaJson } = await import('../../src/lib/json');
  const t = readJacksonTree<Record<string, unknown>>('{"a":5,"b":5.0,"c":1e-7,"d":[1.50]}');
  expect(t.a).toBe(5);
  expect(t.b).toBeInstanceOf(JDouble);
  expect(toJavaJson(t)).toBe('{"a":5,"b":5.0,"c":1.0E-7,"d":[1.5]}');
});

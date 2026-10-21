// Not a Java test port: checks of the Java-semantics helpers the kb port relies on
// (String.split/trim/strip, UUID.fromString, BigDecimal, OffsetDateTime, KbCopyDetector hashes).
import { describe, expect, test } from 'bun:test';
import { dec, Dec } from '../../../src/features/kb/logic/decimal';
import { jStrip } from '../../../src/features/kb/logic/javaString';
import { shinglesOf } from '../../../src/features/kb/logic/kbCopyDetector';
import { Odt } from '../../../src/features/kb/logic/odt';
import { parseUuid } from '../../../src/features/kb/logic/uuid';
import { javaTrim, javaSplit } from '../../../src/lib/javaCompat';

describe('Java semantics helpers', () => {
  test('splitDropsTrailingEmptiesUnlessNegativeLimit', () => {
    expect(javaSplit('a,b,,', /,/)).toEqual(['a', 'b']);
    expect(javaSplit('a,b,,', /,/, -1)).toEqual(['a', 'b', '', '']);
    expect(javaSplit('', /,/)).toEqual(['']);
    expect(javaSplit(',', /,/)).toEqual([]);
    expect(javaSplit('a:b:c:d', /:/, 3)).toEqual(['a', 'b', 'c:d']);
    expect(javaSplit('abc', /(?:)/)).toEqual(['a', 'b', 'c']);
  });

  test('trimAndStrip', () => {
    expect(javaTrim(' x ')).toBe(' x '); // NBSP is > U+0020
    expect(javaTrim('\u0001 x \t')).toBe('x');
    expect(jStrip(' x ')).toBe('x'); // em space is whitespace
    expect(jStrip(' x')).toBe(' x'); // NBSP is not
  });

  test('uuidFromString', () => {
    expect(parseUuid('1-2-3-4-5')).toBe('00000001-0002-0003-0004-000000000005');
    expect(parseUuid('11111111-1111-1111-1111-11111111111A')).toBe('11111111-1111-1111-1111-11111111111a');
    expect(parseUuid('nope')).toBeNull();
    expect(parseUuid('1-2-3-4-5-6')).toBeNull();
  });

  test('bigDecimalScalesAndFormat', () => {
    expect(dec('1.40').multiply(Dec.fromInt(1_000_000)).setScale(4, 'HALF_UP').toString()).toBe('1400000.0000');
    expect(Dec.fromDouble(1.4e-6).toString()).toBe('0.0000014');
    expect(dec('10').stripTrailingZeros().toString()).toBe('1E+1');
    expect(dec('2.5').setScale(0, 'HALF_EVEN').toString()).toBe('2');
    expect(dec('-2.5').setScale(0, 'HALF_UP').toString()).toBe('-3');
    expect(dec('1').divide(dec('3'), 6, 'HALF_UP').toString()).toBe('0.333333');
    expect(dec('0.0000001').toString()).toBe('1E-7');
  });

  test('offsetDateTimeToString', () => {
    expect(Odt.parse('2026-10-03T07:30:00Z').toString()).toBe('2026-10-03T07:30Z');
    expect(Odt.parse('2026-07-11T10:30:00.5-03:00').toString()).toBe('2026-07-11T10:30:00.500-03:00');
    expect(Odt.tryParse('2026-02-30T00:00:00Z')).toBeNull();
  });

  // Values printed by the Java KbCopyDetector.shinglesOf for the same text (sorted).
  test('copyDetectorHashesMatchJava', () => {
    const words: string[] = [];
    for (let i = 0; i < 42; i++) words.push(i % 3 === 0 ? 'Ñandú' + i : 'palabra' + i);
    const s = [...shinglesOf(words.join(' '))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(s).toEqual([-2944034038771828872n, 3715690731062658308n, 8344524926399267354n]);
  });
});

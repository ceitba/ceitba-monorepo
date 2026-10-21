// Port of apps/api/src/test/java/org/ceitba/api/service/drive/SubjectMatcherTest.java
import { describe, expect, test } from 'bun:test';
import { SubjectMatcher } from '../../src/features/drive/logic/subjectMatcher';

const matcher = new SubjectMatcher(new Map([
  ['93.41', 'Física I'],
  ['93.42', 'Física II'],
  ['93.26', 'Análisis Matemático I'],
  ['93.27', 'Análisis Matemático II'],
  ['93.59', 'Matemática I'],
  ['93.61', 'Matemática Discreta'],
  ['72.34', 'Estructuras de Datos y Algoritmos'],
  ['94.21', 'Comunicación'],
]));

describe('SubjectMatcherTest', () => {
  test('matchesNamesAccentAndCaseInsensitively', () => {
    expect(matcher.match('FISICA I')).toBe('93.41');
    expect(matcher.match('Física 2 - parciales')).toBe('93.42');
    expect(matcher.match('fisica 1')).toBe('93.41');
    expect(matcher.match('Analisis Matematico II (2024)')).toBe('93.27');
    expect(matcher.match('comunicacion')).toBe('94.21');
    expect(matcher.match('Estructuras de datos y algoritmos - resumen')).toBe('72.34');
  });

  test('prefersTheMoreSpecificSubject', () => {
    expect(matcher.match('Matemática Discreta')).toBe('93.61');
    expect(matcher.match('Matematica 1')).toBe('93.59');
  });

  test('codesWin', () => {
    expect(matcher.match('93.42 apuntes')).toBe('93.42');
    expect(matcher.match('TP 93-26')).toBe('93.26');
    expect(matcher.match('9341_resumen')).toBe('93.41');
    expect(matcher.match('12.34 unknown code')).toBeNull();
  });

  test('aNameWithoutNumeralMatchesTheFirstOfTheSeries', () => {
    expect(matcher.match('Física')).toBe('93.41');
    expect(matcher.match('Analisis Matematico')).toBe('93.26');
  });

  test('contradictingNumeralsRuleASubjectOut', () => {
    expect(matcher.match('Fisica II')).toBe('93.42');
    expect(matcher.match('Física 3')).toBeNull();
    // Dates are not numerals.
    expect(matcher.match('Fisica 2/5/21')).toBe('93.41');
  });

  test('noMatchBelowThreshold', () => {
    expect(matcher.match('Parcial 1')).toBeNull();
    expect(matcher.match('Varios')).toBeNull();
    expect(matcher.match('')).toBeNull();
    expect(matcher.match(null)).toBeNull();
  });
});

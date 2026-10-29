// Port of apps/api/src/test/java/org/ceitba/api/service/drive/PlanAwareSubjectMatcherTest.java
// Real folder/file names from a student's Drive, with plan A22 (Analítica
// Empresarial y Social) plus subjects outside it.
import { describe, expect, test } from 'bun:test';
import { SubjectMatcher } from '../../src/features/drive/logic/subjectMatcher';

const SUBJECTS = new Map<string, string>([
  // A22
  ['71.80', 'Utilitarios en Informática'],
  ['81.06', 'Introducción a la Administración'],
  ['93.20', 'Análisis Matemático'],
  ['93.21', 'Álgebra'],
  ['71.20', 'Informática General'],
  ['82.15', 'Matemática Aplicada'],
  ['93.16', 'Matemática Discreta'],
  ['94.24', 'Metodología del Aprendizaje'],
  ['93.24', 'Probabilidad y Estadística'],
  // Not in A22
  ['93.41', 'Física I'],
  ['93.42', 'Física II'],
  ['93.04', 'Química'],
  ['94.21', 'Comunicación'],
  ['72.34', 'Estructuras de Datos y Algoritmos'],
  ['72.37', 'Base de Datos I'],
  ['93.59', 'Matemática I'],
]);

// Plan order (year, semester).
const A22 = ['93.20', '93.21', '71.80', '81.06', '82.15', '71.20', '93.16', '94.24', '93.24'];

const withPlan = new SubjectMatcher(SUBJECTS, A22);
const withoutPlan = new SubjectMatcher(SUBJECTS);

describe('PlanAwareSubjectMatcherTest', () => {
  test('realNamesWithThePlan', () => {
    expect(withPlan.match('Resumen Fisica')).toBe('93.41');
    // Plan first: Matemática Aplicada (first word matches, earliest in the
    // plan) over Matemática Discreta, Análisis Matemático and Matemática I.
    expect(withPlan.match('Resumen Mate')).toBe('82.15');
    expect(withPlan.match('Teoría Matemática Discreta full')).toBe('93.16');
    expect(withPlan.match('Resumen estadistica')).toBe('93.24');
    expect(withPlan.match('Resumen metodologia')).toBe('94.24');
    expect(withPlan.match('Resumen Quimica ingreso 2020')).toBe('93.04');
    expect(withPlan.match('Apuntes comunicacion 5/5/20')).toBe('94.21');
    expect(withPlan.match('Gestion de Datos')).toBeNull();
  });

  test('abbreviationsAndPartials', () => {
    expect(withPlan.match('Proba')).toBe('93.24');
    expect(withPlan.match('Discreta')).toBe('93.16');
    expect(withPlan.match('Algebra')).toBe('93.21');
    expect(withPlan.match('Analisis')).toBe('93.20');
    expect(withPlan.match('Fís 2')).toBe('93.42');
    expect(withPlan.match('Admin')).toBe('81.06');
    expect(withPlan.match('EDA final')).toBe('72.34');
  });

  test('withoutThePlanOnlyStrongMatchesCount', () => {
    // One of two words is below the general threshold.
    expect(withoutPlan.match('Resumen metodologia')).toBeNull();
    expect(withoutPlan.match('Resumen estadistica')).toBeNull();
    expect(withoutPlan.match('Resumen Mate')).toBe('93.59');
    expect(withoutPlan.match('Teoría Matemática Discreta full')).toBe('93.16');
    expect(withoutPlan.match('Resumen Quimica ingreso 2020')).toBe('93.04');
  });
});

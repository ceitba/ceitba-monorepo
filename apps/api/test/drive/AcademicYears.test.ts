// Port of apps/api/src/test/java/org/ceitba/api/service/drive/AcademicYearsTest.java
import { describe, expect, test } from 'bun:test';
import { academicYearFromName } from '../../src/features/drive/logic/academicYears';

const NOW = 2026;
const year = (name: string) => academicYearFromName(name, NOW);

describe('AcademicYearsTest', () => {
  test('fourDigitYearsAsTheirOwnToken', () => {
    expect(year('Resumen Quimica ingreso 2020')).toBe(2020);
    expect(year('Parciales 2019')).toBe(2019);
    expect(year('TP-2021_final.pdf')).toBe(2021);
    expect(year('2018 - Apuntes')).toBe(2018);
    expect(year('Final 2019 (recuperatorio 2020)')).toBe(2020);
    expect(year('Apuntes de Física')).toBeNull();
  });

  test('termMarkersWithTwoDigitYears', () => {
    expect(year("Parcial 1C'21")).toBe(2021);
    expect(year('Final 2C-22')).toBe(2022);
    expect(year('cuatri-20 resumen')).toBe(2020);
    expect(year("Cuatrimestre 2 '19")).toBe(2019);
  });

  test('negatives', () => {
    expect(year('Tabla 2000 filas')).toBeNull();
    expect(year('12020 casos')).toBeNull();
    expect(year('Ejercicio 2050')).toBeNull(); // future
    expect(year('v2021b')).toBeNull(); // not its own token
    expect(year('Apuntes comunicacion 5/5/20')).toBeNull();
    expect(year('TP 21')).toBeNull(); // 2 digits without a term marker
    expect(year('1999 resumen')).toBeNull();
  });
});

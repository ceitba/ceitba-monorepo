// Port of apps/api/src/main/java/org/ceitba/api/service/drive/AcademicYears.java.
//
// The academic year written in a file or folder name (best effort):
//   - a 4-digit year 2000..currentYear standing as its own token
//     ("Resumen Quimica ingreso 2020", "Parciales_2019", "TP-2021"), unless
//     it is a quantity ("Tabla 2000 filas");
//   - a 2-digit year after a term marker: 1C'21, 2C-22, 1c 21, cuatri-21,
//     cuatrimestre 2 '20.
// The last match wins ("Final 2019 (recuperatorio 2020)" -> 2020).

import { JAVA_S, javaIsBlank } from '../../../lib/javaCompat';
import { foldAccentsLower } from '../../../lib/subjectText';

const S = JAVA_S;
const FULL = /(?<![0-9a-z])(20[0-9]{2})(?![0-9a-z])/g;
const TERM = new RegExp(
  `(?<![0-9a-z])(?:[12]${S}*c|cuatri(?:mestre)?(?:${S}*[12])?)${S}*(?:'|-|${S})${S}*'?([0-9]{2})(?![0-9a-z])`, 'g');
// Words that make the number a quantity, not a year.
const QUANTITIES = new Set([
  'filas', 'columnas', 'datos', 'registros', 'pesos', 'dolares', 'usd', 'ars', 'palabras', 'paginas',
  'hojas', 'km', 'kg', 'mts', 'metros', 'unidades', 'personas', 'casos', 'items', 'lineas', 'caracteres']);
const NEXT_WORD = new RegExp(`^${S}+([a-z]+)`);


/** AcademicYears.fromName: the year, or null (OptionalInt.empty()). */
export function academicYearFromName(name: string | null | undefined, currentYear: number): number | null {
  if (name == null || javaIsBlank(name)) return null;
  const text = foldAccentsLower(name);
  let found = -1;
  let foundAt = -1;
  for (const m of text.matchAll(FULL)) {
    const year = Number(m[1]);
    if (year > currentYear) continue;
    const next = NEXT_WORD.exec(text.slice(m.index + m[0].length));
    if (next && QUANTITIES.has(next[1]!)) continue;
    if (m.index >= foundAt) {
      found = year;
      foundAt = m.index;
    }
  }
  for (const t of text.matchAll(TERM)) {
    const year = 2000 + Number(t[1]);
    if (year > currentYear) continue;
    if (t.index >= foundAt) {
      found = year;
      foundAt = t.index;
    }
  }
  return found < 0 ? null : found;
}

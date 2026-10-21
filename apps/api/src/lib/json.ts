// Jackson-compatible JSON output (docs/SERIALIZATION.md).
//
// JSON.stringify already matches Jackson for strings, booleans, null, integers
// and objects/arrays (key order = insertion order = Java record component order).
// The differences handled here:
//   - control characters: Jackson writes \u001F (upper-case hex), JS \u001f;
//   - Java `double`/`Double` fields: Jackson writes 1.0 / 1.0E20 (javaDouble);
//   - `float`: Float.toString digits (javaFloat);
//   - BigDecimal (Postgres numeric): the exact decimal text, e.g. 5.00 (bigDecimal).
// Numbers that need Java formatting are emitted with JSON.rawJSON, which
// JSON.stringify writes verbatim.

type RawJson = ReturnType<typeof JSON.rawJSON>;

function javaDecimalFromDigits(neg: boolean, digits: string, exp10: number): string {
  // digits: d1d2...dn meaning d1.d2...dn x 10^exp10
  const sign = neg ? '-' : '';
  if (exp10 >= -3 && exp10 < 7) {
    if (exp10 >= 0) {
      const intPart = digits.slice(0, exp10 + 1).padEnd(exp10 + 1, '0');
      const frac = digits.slice(exp10 + 1) || '0';
      return `${sign}${intPart}.${frac}`;
    }
    return `${sign}0.${'0'.repeat(-exp10 - 1)}${digits}`;
  }
  const mant = `${digits[0]}.${digits.slice(1) || '0'}`;
  return `${sign}${mant}E${exp10}`;
}

function shortestDigits(n: number): { neg: boolean; digits: string; exp: number } {
  const neg = n < 0 || Object.is(n, -0);
  const [m, e] = Math.abs(n).toExponential().split('e') as [string, string];
  return { neg, digits: m.replace('.', ''), exp: Number(e) };
}

/** Double.toString(d) as Jackson writes a Java double: 1.0, 0.001, 1.0E7, 1.5E-7. */
export function javaDoubleString(n: number): string {
  if (Number.isNaN(n)) return '"NaN"';
  if (!Number.isFinite(n)) return n > 0 ? '"Infinity"' : '"-Infinity"';
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0';
  const { neg, digits, exp } = shortestDigits(n);
  return javaDecimalFromDigits(neg, digits, exp);
}

/** A Java double field: serializes like Jackson (`1.0`, not `1`). */
export function javaDouble(n: number | null | undefined): RawJson | null {
  if (n == null) return null;
  return JSON.rawJSON(javaDoubleString(n));
}

/** A Java float field (Float.toString digits, e.g. 0.1 not 0.10000000149011612). */
export function javaFloat(n: number | null | undefined): RawJson | null {
  if (n == null) return null;
  const f = Math.fround(n);
  if (!Number.isFinite(f) || f === 0) return JSON.rawJSON(javaDoubleString(f));
  let digits = '';
  let exp = 0;
  for (let p = 1; p <= 9; p++) {
    const s = Math.abs(f).toExponential(p - 1);
    if (Math.fround(Number(s)) === Math.abs(f)) {
      const [m, e] = s.split('e') as [string, string];
      digits = m.replace('.', '').replace(/0+$/, '') || '0';
      exp = Number(e);
      break;
    }
  }
  return JSON.rawJSON(javaDecimalFromDigits(f < 0, digits, exp));
}

/**
 * BigDecimal.toString() of a Postgres numeric text value, as a raw JSON number
 * (`5.00` stays `5.00`). Scientific notation follows BigDecimal: used when the
 * scale is negative or the adjusted exponent is below -6 (`0.0000001` -> `1E-7`).
 */
export function bigDecimalString(pg: string): string {
  const s = pg.trim();
  if (s === 'NaN') return '"NaN"';
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not a numeric value: ${pg}`);
  const neg = m[1] === '-';
  const intDigits = m[2] ?? '';
  const fracDigits = m[3] ?? '';
  const scale = fracDigits.length;
  let unscaled = (intDigits + fracDigits).replace(/^0+(?=\d)/, '');
  if (unscaled === '') unscaled = '0';
  const precision = unscaled.length;
  const adjusted = precision - scale - 1;
  const sign = neg && /[1-9]/.test(unscaled) ? '-' : (neg ? '-' : '');
  if (scale >= 0 && adjusted >= -6) {
    if (scale === 0) return sign + unscaled;
    const padded = unscaled.padStart(scale + 1, '0');
    return `${sign}${padded.slice(0, padded.length - scale)}.${padded.slice(padded.length - scale)}`;
  }
  const mant = unscaled.length > 1 ? `${unscaled[0]}.${unscaled.slice(1)}` : unscaled;
  return `${sign}${mant}E${adjusted >= 0 ? '+' : ''}${adjusted}`;
}

export function bigDecimal(pg: string | null | undefined): RawJson | null {
  if (pg == null) return null;
  return JSON.rawJSON(bigDecimalString(pg));
}

// After JSON.stringify: upper-case the hex of \u escapes (Jackson), leaving an
// escaped backslash followed by "u00.." (literal text) alone.
const LOWER_U_ESCAPE = /(?<!\\)((?:\\\\)*)\\u([0-9a-f]{4})/g;

/** JSON text exactly as Spring's Jackson ObjectMapper writes `value`. */
export function toJavaJson(value: unknown): string {
  const s = JSON.stringify(value);
  if (s === undefined) return 'null';
  if (!s.includes('\\u')) return s;
  return s.replace(LOWER_U_ESCAPE, (_m, bs: string, hex: string) => `${bs}\\u${hex.toUpperCase()}`);
}

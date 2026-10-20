// java.lang.String / Character semantics the kb logic relies on, where the JS
// built-ins differ. Used by every module under features/kb/logic so the port
// behaves exactly like apps/api (Java 21).

/** String.trim(): strips every char <= U+0020 (JS trim() also strips NBSP, U+FEFF...). */
export function jTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return start === 0 && end === s.length ? s : s.substring(start, end);
}

/**
 * Character.isWhitespace(codePoint): Unicode space separators (Zs, Zl, Zp) except the
 * non-breaking ones (U+00A0, U+2007, U+202F), plus \t \n U+000B \f \r and U+001C-U+001F.
 */
export function isJavaWhitespace(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d) return true;
  if (cp >= 0x1c && cp <= 0x1f) return true;
  if (cp === 0xa0 || cp === 0x2007 || cp === 0x202f) return false;
  return SEPARATOR.test(String.fromCodePoint(cp));
}
const SEPARATOR = /^[\p{Zs}\p{Zl}\p{Zp}]$/u;

/** String.strip(): Character.isWhitespace on code points. */
export function jStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end) {
    const cp = s.codePointAt(start)!;
    if (!isJavaWhitespace(cp)) break;
    start += cp > 0xffff ? 2 : 1;
  }
  while (end > start) {
    let i = end - 1;
    const low = s.charCodeAt(i);
    if (low >= 0xdc00 && low <= 0xdfff && i > start) {
      const high = s.charCodeAt(i - 1);
      if (high >= 0xd800 && high <= 0xdbff) i--;
    }
    if (!isJavaWhitespace(s.codePointAt(i)!)) break;
    end = i;
  }
  return start === 0 && end === s.length ? s : s.substring(start, end);
}

/** String.isBlank(). */
export function jIsBlank(s: string): boolean {
  return jStrip(s).length === 0;
}

/**
 * String.split(regex, limit). limit 0 (Java's default) drops trailing empty strings;
 * a negative limit keeps them. `re` must have no capture groups (JS splices captures
 * into the result). A zero-width match at index 0 never yields a leading "".
 */
export function jSplit(s: string, re: RegExp | string, limit = 0): string[] {
  if (typeof re === 'string') {
    // single literal char (the only string form used): no regex needed
    if (limit > 0) throw new Error('jSplit: positive limit needs a RegExp');
    const parts = s.split(re);
    return limit === 0 ? dropTrailingEmpty(parts) : parts;
  }
  // Pattern.split (JDK 8+), match by match.
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const g = new RegExp(re.source, flags);
  const out: string[] = [];
  let index = 0;
  let m: RegExpExecArray | null;
  while ((m = g.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) g.lastIndex++;
    if (limit > 0 && out.length >= limit - 1) break;
    if (index === 0 && start === 0 && start === end) continue;
    out.push(s.substring(index, start));
    index = end;
  }
  if (index === 0 && out.length === 0) return [s];
  out.push(s.substring(index));
  if (limit !== 0) return out;
  let n = out.length;
  while (n > 0 && out[n - 1] === '') n--;
  return out.slice(0, n);
}

function dropTrailingEmpty(parts: string[]): string[] {
  if (parts.length === 1) return parts; // no match: the input itself, even ""
  let n = parts.length;
  while (n > 0 && parts[n - 1] === '') n--;
  return parts.slice(0, n);
}

/** String.split(regex, 2) for a literal separator: at most two parts. */
export function jSplit2(s: string, sep: string): string[] {
  const at = s.indexOf(sep);
  return at < 0 ? [s] : [s.substring(0, at), s.substring(at + sep.length)];
}

/** String.hashCode(): 32-bit, over UTF-16 code units. */
export function jHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const LETTER = /^\p{L}$/u;
const DIGIT = /^\p{Nd}$/u;

/** Character.isLetterOrDigit(char): one UTF-16 unit (a lone surrogate is neither). */
export function isLetterOrDigitChar(c: string): boolean {
  return LETTER.test(c) || DIGIT.test(c);
}

/** Character.toLowerCase(char): the simple (1:1) mapping. */
export function charToLowerCase(c: string): string {
  if (c === 'İ') return 'i'; // the only char whose full lowercase mapping is longer
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
}

/** String.toLowerCase(Locale.ROOT) / toUpperCase(Locale.ROOT): JS's are locale-independent too. */
export const lowerRoot = (s: string): string => s.toLowerCase();
export const upperRoot = (s: string): string => s.toUpperCase();

/** String.equalsIgnoreCase (char-by-char upper then lower comparison). */
export function equalsIgnoreCase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    const ux = charToUpperCase(x);
    const uy = charToUpperCase(y);
    if (ux === uy) continue;
    if (charToLowerCase(ux) === charToLowerCase(uy)) continue;
    return false;
  }
  return true;
}

function charToUpperCase(c: string): string {
  const u = c.toUpperCase();
  return u.length === 1 ? u : c;
}

/** Java regex `\s` (ASCII only: [ \t\n\x0B\f\r]) for use in RegExp sources (JS `\s` is Unicode-wide). */
export const S = '[ \\t\\n\\x0B\\f\\r]';
/** Java regex `.` without DOTALL: anything but \n \r U+0085 U+2028 U+2029 (JS `.` matches U+0085). */
export const DOT = '[^\\n\\r\\u0085\\u2028\\u2029]';

/** String.valueOf(Object) for values that came from YAML/JSON (numbers print like Java's Integer/Double). */
export function javaValueOf(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return javaDouble(v);
  }
  if (Array.isArray(v)) return `[${v.map(javaValueOf).join(', ')}]`;
  if (typeof v === 'object' && !(v instanceof Date)) {
    return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}=${javaValueOf(x)}`).join(', ')}}`;
  }
  return String(v);
}

function javaDouble(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  const [m, e] = Math.abs(n).toExponential().split('e') as [string, string];
  const digits = m.replace('.', '');
  const exp = Number(e);
  const sign = n < 0 ? '-' : '';
  if (exp >= -3 && exp < 7) {
    if (exp >= 0) return `${sign}${digits.slice(0, exp + 1).padEnd(exp + 1, '0')}.${digits.slice(exp + 1) || '0'}`;
    return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  }
  return `${sign}${digits[0]}.${digits.slice(1) || '0'}E${exp}`;
}

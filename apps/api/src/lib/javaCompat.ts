// java.lang / java.util / java.net behaviour that the ported pure logic relies
// on and that the JS built-ins get subtly wrong. Each helper names the Java
// method it emulates. Use these instead of String.prototype.trim/split/replace,
// encodeURIComponent, Buffer.from(.., 'base64') etc. in ported code.

// ------------------------------------------------------------ whitespace

/** Java regex `\s` (no UNICODE_CHARACTER_CLASS): ASCII only. JS `\s` also matches NBSP, U+2028, BOM... */
export const JAVA_S = '[ \\t\\n\\x0B\\f\\r]';
/** Java regex `\S`. */
export const JAVA_NOT_S = '[^ \\t\\n\\x0B\\f\\r]';
/**
 * Java regex `\R`: `\r\n|[\n\x0B\f\r\u0085\u2028\u2029]`. It is NOT atomic in
 * JDK 21 (verified against the JDK): in `\R\s*\R` a lone "\r\n" matches as
 * two line breaks, so a CRLF single line break counts as a blank line.
 */
export const JAVA_R = '(?:\\r\\n|[\\n\\x0B\\f\\r\\u0085\\u2028\\u2029])';

/** Character.isWhitespace(cp). */
export function isJavaWhitespace(cp: number): boolean {
  if (cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || (cp >= 0x1c && cp <= 0x1f)) return true;
  if (cp === 0xa0 || cp === 0x2007 || cp === 0x202f) return false;
  return cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029
    || cp === 0x205f || cp === 0x3000;
}

/** String.strip(): removes leading/trailing Character.isWhitespace (not NBSP). */
export function javaStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isJavaWhitespace(s.charCodeAt(start))) start++;
  while (end > start && isJavaWhitespace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

/** String.trim(): removes leading/trailing chars <= U+0020. */
export function javaTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return s.slice(start, end);
}

/** String.isBlank(). */
export function javaIsBlank(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (!isJavaWhitespace(s.charCodeAt(i))) return false;
  return true;
}

// ------------------------------------------------------------ split / replace

/**
 * String.split(regex, limit). `re` is used as a global regex. limit 0 (the
 * default) drops trailing empty strings; a limit > 0 keeps the remainder in
 * the last element (JS split truncates instead); limit < 0 keeps everything.
 * A zero-width match at index 0 never yields a leading empty string (Java 8+).
 */
export function javaSplit(s: string, re: RegExp, limit = 0): string[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const list: string[] = [];
  let index = 0;
  let m: RegExpExecArray | null;
  while ((m = g.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) g.lastIndex = end + 1;
    if (limit <= 0 || list.length < limit - 1) {
      // No empty leading substring for a zero-width match at the beginning.
      if (index === 0 && start === 0 && end === 0) continue;
      list.push(s.slice(index, start));
      index = end;
    } else if (list.length === limit - 1) {
      list.push(s.slice(index));
      index = end;
      break;
    }
  }
  if (index === 0) return [s];
  if (limit <= 0 || list.length < limit) list.push(s.slice(index));
  if (limit === 0) {
    let n = list.length;
    while (n > 0 && list[n - 1] === '') n--;
    list.length = n;
  }
  return list;
}

/** String.replace(CharSequence, CharSequence): literal, every occurrence, no `$` expansion. */
export function replaceLiteral(s: string, target: string, replacement: string): string {
  return s.split(target).join(replacement);
}

// ------------------------------------------------------------ URL encoding

const URL_SAFE = /[A-Za-z0-9.\-*_]/;
const utf8 = new TextEncoder();

/** URLEncoder.encode(s, UTF_8): space -> '+', unreserved = A-Za-z0-9 . - * _ , the rest %XX (upper case). */
export function javaUrlEncode(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === ' ') out += '+';
    else if (ch.length === 1 && URL_SAFE.test(ch)) out += ch;
    else {
      // A lone surrogate is unmappable: the encoder writes '?'.
      const cp = ch.codePointAt(0)!;
      const bytes = cp >= 0xd800 && cp <= 0xdfff ? [0x3f] : utf8.encode(ch);
      for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** Thrown where Java throws IllegalArgumentException (and its NumberFormatException subclass). */
export class JavaIllegalArgument extends Error {}

const utf8Lenient = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/**
 * URLDecoder.decode(s, UTF_8): '+' -> space, runs of %XX decoded as UTF-8
 * (malformed bytes become U+FFFD), a bad escape throws JavaIllegalArgument.
 * Like Integer.parseInt(.., 16), an escape digit pair may start with '+'.
 */
export function javaUrlDecode(s: string): string {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    let c = s[i]!;
    if (c === '+') {
      out += ' ';
      i++;
    } else if (c === '%') {
      const bytes: number[] = [];
      while (i + 2 < n && c === '%') {
        const v = parseIntRadix(s.slice(i + 1, i + 3), 16);
        if (v < 0) throw new JavaIllegalArgument('URLDecoder: Illegal hex characters in escape (%) pattern - negative value');
        bytes.push(v & 0xff);
        i += 3;
        if (i < n) c = s[i]!;
      }
      if (i < n && c === '%') throw new JavaIllegalArgument('URLDecoder: Incomplete trailing escape (%) pattern');
      out += utf8Lenient.decode(new Uint8Array(bytes));
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Integer.parseInt(s, radix) for small values (ASCII digits only). */
function parseIntRadix(s: string, radix: number): number {
  const m = radix === 16 ? /^[+-]?[0-9a-fA-F]+$/.exec(s) : /^[+-]?[0-9]+$/.exec(s);
  if (!m) throw new JavaIllegalArgument(`For input string: "${s}"${radix === 10 ? '' : ` under radix ${radix}`}`);
  return parseInt(s, radix);
}

// ------------------------------------------------------------ numbers

/**
 * Long.parseLong(s) (radix 10): optional sign and digits, no blanks, no
 * exponent, range-checked. Returns a number (exact up to 2^53, enough for
 * epoch seconds); throws JavaIllegalArgument like NumberFormatException.
 * Only ASCII digits (Java also accepts other Unicode Nd digits).
 */
export function javaParseLong(s: string): number {
  if (!/^[+-]?[0-9]+$/.test(s)) throw new JavaIllegalArgument(`For input string: "${s}"`);
  const b = BigInt(s);
  if (b > 9223372036854775807n || b < -9223372036854775808n) throw new JavaIllegalArgument(`For input string: "${s}"`);
  return Number(b);
}

// ------------------------------------------------------------ base64

const B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function table(alphabet: string): Int8Array {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < alphabet.length; i++) t[alphabet.charCodeAt(i)] = i;
  t['='.charCodeAt(0)] = -2;
  return t;
}
const T_STD = table(B64_STD);
const T_URL = table(B64_URL);

/**
 * java.util.Base64.Decoder.decode(String) of the basic (getDecoder) or URL
 * (getUrlDecoder) decoder: padding optional but must be right when present,
 * no other characters allowed, unused trailing bits ignored. Throws
 * JavaIllegalArgument where Java throws IllegalArgumentException.
 */
export function javaBase64Decode(s: string, url = false): Uint8Array {
  const t = url ? T_URL : T_STD;
  // decode(String) goes through ISO-8859-1: anything above U+00FF becomes '?'.
  const src = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    src[i] = c > 0xff ? 0x3f : c;
  }
  const sl = src.length;
  if (sl === 0) return new Uint8Array(0);
  if (sl < 2) throw new JavaIllegalArgument('Input byte[] should at least have 2 bytes for base64 bytes');
  const out: number[] = [];
  let sp = 0;
  let bits = 0;
  let shiftto = 18;
  while (sp < sl) {
    let b = src[sp++]!;
    b = t[b]!;
    if (b < 0) {
      if (b === -2) {
        if ((shiftto === 6 && (sp === sl || src[sp++] !== 0x3d)) || shiftto === 18) {
          throw new JavaIllegalArgument('Input byte array has wrong 4-byte ending unit');
        }
        break;
      }
      throw new JavaIllegalArgument(`Illegal base64 character ${src[sp - 1]!.toString(16)}`);
    }
    bits |= b << shiftto;
    shiftto -= 6;
    if (shiftto < 0) {
      out.push((bits >> 16) & 0xff, (bits >> 8) & 0xff, bits & 0xff);
      shiftto = 18;
      bits = 0;
    }
  }
  if (shiftto === 6) out.push((bits >> 16) & 0xff);
  else if (shiftto === 0) out.push((bits >> 16) & 0xff, (bits >> 8) & 0xff);
  else if (shiftto === 12) throw new JavaIllegalArgument('Last unit does not have enough valid bits');
  if (sp < sl) throw new JavaIllegalArgument(`Input byte array has incorrect ending byte at ${sp}`);
  return new Uint8Array(out);
}

/** Base64.getEncoder().encodeToString (padded). */
export function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Base64.getUrlEncoder().withoutPadding().encodeToString. */
export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

// ------------------------------------------------------------ UUID

/** What UUID.toString() prints: lower-case 8-4-4-4-12. `UUID.fromString(s).toString().equals(s)` iff this matches. */
export const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseHexLong(s: string): bigint {
  if (!/^[+-]?[0-9a-fA-F]+$/.test(s)) throw new JavaIllegalArgument(`Error at index 0 in: "${s}"`);
  const neg = s.startsWith('-');
  const v = BigInt(`0x${s.replace(/^[+-]/, '')}`);
  const r = neg ? -v : v;
  if (r > 0x7fffffffffffffffn || r < -0x8000000000000000n) throw new JavaIllegalArgument(`For input string: "${s}"`);
  return r;
}

/**
 * UUID.fromString(s).toString(): accepts the lenient spellings Java accepts
 * ("1-2-3-4-5", upper case, signs) and returns the canonical form; throws
 * JavaIllegalArgument otherwise.
 */
export function javaUuidFromString(s: string): string {
  if (s.length === 36 && s[8] === '-' && s[13] === '-' && s[18] === '-' && s[23] === '-'
      && /^[0-9a-fA-F-]{36}$/.test(s) && (s.match(/-/g) ?? []).length === 4) {
    return s.toLowerCase();
  }
  if (s.length > 36) throw new JavaIllegalArgument(`UUID string too large`);
  const d1 = s.indexOf('-');
  const d2 = s.indexOf('-', d1 + 1);
  const d3 = s.indexOf('-', d2 + 1);
  const d4 = s.indexOf('-', d3 + 1);
  const d5 = s.indexOf('-', d4 + 1);
  if (d4 < 0 || d5 >= 0) throw new JavaIllegalArgument(`Invalid UUID string: ${s}`);
  const mask = (v: bigint, bits: number) => BigInt.asUintN(bits, v);
  const a = mask(parseHexLong(s.slice(0, d1)), 32);
  const b = mask(parseHexLong(s.slice(d1 + 1, d2)), 16);
  const c = mask(parseHexLong(s.slice(d2 + 1, d3)), 16);
  const d = mask(parseHexLong(s.slice(d3 + 1, d4)), 16);
  const e = mask(parseHexLong(s.slice(d4 + 1)), 48);
  const hex = (v: bigint, w: number) => v.toString(16).padStart(w, '0');
  return `${hex(a, 8)}-${hex(b, 4)}-${hex(c, 4)}-${hex(d, 4)}-${hex(e, 12)}`;
}

/** UUID.compareTo: most then least significant 64 bits, compared as SIGNED longs. */
export function compareUuid(x: string, y: string): number {
  const halves = (u: string) => {
    const h = u.replace(/-/g, '');
    return [BigInt.asIntN(64, BigInt(`0x${h.slice(0, 16)}`)), BigInt.asIntN(64, BigInt(`0x${h.slice(16)}`))] as const;
  };
  const [xm, xl] = halves(x);
  const [ym, yl] = halves(y);
  if (xm !== ym) return xm < ym ? -1 : 1;
  if (xl !== yl) return xl < yl ? -1 : 1;
  return 0;
}

// ------------------------------------------------------------ strings

/** String.hashCode() (int32). */
export function javaHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Character.toUpperCase(char) on one UTF-16 unit: keeps the char when the full mapping is not 1:1 (ß stays ß). */
export function javaCharToUpperCase(ch: string): string {
  const u = ch.toUpperCase();
  return u.length === 1 ? u : ch;
}

/** String.equalsIgnoreCase (char by char, upper then lower case). */
export function javaEqualsIgnoreCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    const ux = javaCharToUpperCase(x);
    const uy = javaCharToUpperCase(y);
    if (ux === uy) continue;
    if (ux.toLowerCase() === uy.toLowerCase()) continue;
    return false;
  }
  return true;
}

/** String.compareTo: UTF-16 code unit order (same as JS `<`). */
export function javaCompareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ------------------------------------------------------------ LocalDate (ISO 'YYYY-MM-DD' strings)

export type LocalDate = string;

const DAY_MS = 86_400_000;

/** LocalDate.toEpochDay(). */
export function epochDay(d: LocalDate): number {
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Not a LocalDate: ${d}`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** LocalDate.ofEpochDay(n). */
export function ofEpochDay(n: number): LocalDate {
  const dt = new Date(n * DAY_MS);
  const y = dt.getUTCFullYear();
  const ys = y > 9999 ? `+${y}` : String(y).padStart(4, '0');
  return `${ys}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export const plusDays = (d: LocalDate, n: number): LocalDate => ofEpochDay(epochDay(d) + n);
export const compareDates = (a: LocalDate, b: LocalDate): number => epochDay(a) - epochDay(b);
export const isBefore = (a: LocalDate, b: LocalDate): boolean => epochDay(a) < epochDay(b);
export const isAfter = (a: LocalDate, b: LocalDate): boolean => epochDay(a) > epochDay(b);

/** DayOfWeek.getValue(): 1 = Monday ... 7 = Sunday. */
export function dayOfWeek(d: LocalDate): number {
  // 1970-01-01 was a Thursday (4).
  return ((((epochDay(d) + 3) % 7) + 7) % 7) + 1;
}
export const monthOf = (d: LocalDate): number => Number(d.slice(-5, -3));
export const dayOfMonth = (d: LocalDate): number => Number(d.slice(-2));

// es-AR display names as java.time prints them (TextStyle FULL / SHORT,
// JDK 21 CLDR). Taken from the JDK, not Intl: ICU and the JDK's CLDR data can
// disagree on abbreviations.
export const ES_MONTHS_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
export const ES_MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] as const;
/** Index 0 = MONDAY. */
export const ES_DAYS_FULL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
export const ES_DAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;
export const DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

// ------------------------------------------------------------ bytes

/**
 * String.getBytes(UTF_8): like TextEncoder, except that a lone surrogate is
 * unmappable and becomes '?' (0x3F) instead of U+FFFD.
 */
export function javaUtf8(s: string): Uint8Array {
  if (!/[\uD800-\uDFFF]/.test(s)) return utf8.encode(s);
  return utf8.encode(s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '?'));
}

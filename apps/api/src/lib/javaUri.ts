// java.net.URI parsing (RFC 2396 + Java's deviations), as `URI.create(s)`
// does it: the WHATWG URL parser accepts and normalizes far more (spaces,
// '<', backslashes, IDNA...), so ported code that branches on URI.create
// throwing, or on getHost()/getRawPath()/getRawQuery(), uses this instead.
// Port of the parser in java.net.URI (JDK 21), without the normalization or
// resolution parts. IPv4 detection is simplified to dotted quads <= 255.

export class JavaUriSyntaxError extends Error {}

export interface JavaUri {
  scheme: string | null;
  /** Server-based authority host (null for registry-based or no authority, like getHost()). */
  host: string | null;
  port: number;
  rawAuthority: string | null;
  rawUserInfo: string | null;
  /** getRawPath(); null for opaque URIs. */
  rawPath: string | null;
  rawQuery: string | null;
  rawFragment: string | null;
  opaque: boolean;
}

// Character classes (ASCII; see URI.java's L_/H_ masks).
const DIGIT = '0123456789';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ALPHANUM = ALPHA + DIGIT;
const MARK = "-_.!~*'()";
const UNRESERVED = ALPHANUM + MARK;
const RESERVED = ';/?:@&=+$,[]';
const set = (chars: string, escaped: boolean) => ({ chars: new Set(chars), escaped });
const URIC = set(RESERVED + UNRESERVED, true);
const PATH = set(UNRESERVED + ':@&=+$,' + ';/', true);
const USERINFO = set(UNRESERVED + ';:&=+$,', true);
const REG_NAME = set(UNRESERVED + '$,;:@&=+', true);
const SERVER = set(UNRESERVED + ';:&=+$,' + ALPHANUM + '-' + '.:@[]', true);
const SERVER_PERCENT = set(UNRESERVED + ';:&=+$,' + ALPHANUM + '-' + '.:@[]' + '%', true);
const SCHEME = set(ALPHA + DIGIT + '+-.', false);
const C_ALPHA = set(ALPHA, false);
const C_ALPHANUM = set(ALPHANUM, false);
const C_ALPHANUM_DASH = set(ALPHANUM + '-', false);
const C_DIGIT = set(DIGIT, false);
const SCOPE_ID = set(ALPHANUM + '_.', false);
const HEX = new Set('0123456789abcdefABCDEF');

type CharSet = ReturnType<typeof set>;

function isSpaceChar(c: number): boolean {
  // Character.isSpaceChar: Zs, Zl, Zp.
  return /[\p{Zs}\p{Zl}\p{Zp}]/u.test(String.fromCharCode(c));
}
function isIsoControl(c: number): boolean {
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f);
}

class Parser {
  scheme: string | null = null;
  host: string | null = null;
  port = -1;
  authority: string | null = null;
  userInfo: string | null = null;
  path: string | null = null;
  query: string | null = null;
  fragment: string | null = null;

  constructor(private readonly input: string) {}

  private fail(reason: string, p?: number): never {
    throw new JavaUriSyntaxError(`${reason}${p === undefined ? '' : ` at index ${p}`}: ${this.input}`);
  }
  private failExpecting(expected: string, p: number): never {
    this.fail(`Expected ${expected}`, p);
  }
  private at(start: number, end: number, c: string): boolean {
    return start < end && this.input[start] === c;
  }
  /** scan(start, end, err, stop) */
  private scanStop(start: number, end: number, err: string, stop: string): number {
    let p = start;
    while (p < end) {
      const c = this.input[p]!;
      if (err.includes(c)) return -1;
      if (stop.includes(c)) break;
      p++;
    }
    return p;
  }
  private scanEscape(start: number, n: number, first: string): number {
    const p = start;
    const c = first.charCodeAt(0);
    if (first === '%') {
      if (p + 3 <= n && HEX.has(this.input[p + 1]!) && HEX.has(this.input[p + 2]!)) return p + 3;
      this.fail('Malformed escape pair', p);
    } else if (c > 128 && !isSpaceChar(c) && !isIsoControl(c)) {
      // Allow unescaped but visible non-US-ASCII chars.
      return p + 1;
    }
    return p;
  }
  /** scan(start, end, lowMask, highMask) */
  private scan(start: number, end: number, cls: CharSet): number {
    let p = start;
    while (p < end) {
      const c = this.input[p]!;
      if (c.charCodeAt(0) < 128 && cls.chars.has(c)) {
        p++;
        continue;
      }
      if (cls.escaped) {
        const q = this.scanEscape(p, end, c);
        if (q > p) {
          p = q;
          continue;
        }
      }
      break;
    }
    return p;
  }
  private checkChars(start: number, end: number, cls: CharSet, what: string): void {
    const p = this.scan(start, end, cls);
    if (p < end) this.fail(`Illegal character in ${what}`, p);
  }

  parse(requireServerAuthority: boolean): void {
    this.requireServerAuthority = requireServerAuthority;
    const n = this.input.length;
    let p = this.scanStop(0, n, '/?#', ':');
    let ssp: number;
    if (p >= 0 && this.at(p, n, ':')) {
      if (p === 0) this.failExpecting('scheme name', 0);
      if (!(this.input.charCodeAt(0) < 128 && C_ALPHA.chars.has(this.input[0]!))) this.fail('Illegal character in scheme name', 0);
      this.checkChars(1, p, SCHEME, 'scheme name');
      this.scheme = this.input.slice(0, p);
      p++;
      ssp = p;
      if (this.at(p, n, '/')) {
        p = this.parseHierarchical(p, n);
      } else {
        const q = this.scanStop(p, n, '', '#');
        if (q <= p) this.failExpecting('scheme-specific part', p);
        this.checkChars(p, q, URIC, 'opaque part');
        this.opaque = true;
        p = q;
      }
    } else {
      ssp = 0;
      p = this.parseHierarchical(0, n);
    }
    void ssp;
    if (this.at(p, n, '#')) {
      this.checkChars(p + 1, n, URIC, 'fragment');
      this.fragment = this.input.slice(p + 1, n);
      p = n;
    }
    if (p < n) this.fail('Expected end of URI', p);
  }

  opaque = false;
  private requireServerAuthority = false;

  private parseHierarchical(start: number, n: number): number {
    let p = start;
    if (this.at(p, n, '/') && this.at(p + 1, n, '/')) {
      p += 2;
      const q = this.scanStop(p, n, '', '/?#');
      if (q > p) p = this.parseAuthority(p, q);
      else if (q < n) {
        // DEVIATION: empty authority before a non-empty path, query or fragment.
      } else this.failExpecting('authority', p);
    }
    let q = this.scanStop(p, n, '', '?#');
    this.checkChars(p, q, PATH, 'path');
    this.path = this.input.slice(p, q);
    p = q;
    if (this.at(p, n, '?')) {
      p++;
      q = this.scanStop(p, n, '', '#');
      this.checkChars(p, q, URIC, 'query');
      this.query = this.input.slice(p, q);
      p = q;
    }
    return p;
  }

  private parseAuthority(start: number, n: number): number {
    const p = start;
    let q = p;
    let ex: unknown = null;
    const serverChars = this.scanStop(p, n, '', ']') > p
      ? this.scan(p, n, SERVER_PERCENT) === n
      : this.scan(p, n, SERVER) === n;
    const qreg = this.scan(p, n, REG_NAME);
    const regChars = qreg === n;
    if (regChars && !serverChars) {
      this.authority = this.input.slice(p, n);
      return n;
    }
    if (serverChars) {
      try {
        q = this.parseServer(p, n);
        if (q < n) this.failExpecting('end of authority', q);
        this.authority = this.input.slice(p, n);
      } catch (x) {
        if (!(x instanceof JavaUriSyntaxError)) throw x;
        this.userInfo = null;
        this.host = null;
        this.port = -1;
        if (this.requireServerAuthority) throw x;
        ex = x;
        q = p;
      }
    }
    if (q < n) {
      if (regChars) this.authority = this.input.slice(p, n);
      else if (ex != null) throw ex;
      else this.fail('Illegal character in authority', serverChars ? q : qreg);
    }
    return n;
  }

  private parseServer(start: number, n: number): number {
    let p = start;
    let q = this.scanStop(p, n, '/?#', '@');
    if (q >= p && this.at(q, n, '@')) {
      this.checkChars(p, q, USERINFO, 'user info');
      this.userInfo = this.input.slice(p, q);
      p = q + 1;
    }
    if (this.at(p, n, '[')) {
      p++;
      q = this.scanStop(p, n, '/?#', ']');
      if (q > p && this.at(q, n, ']')) {
        const r = this.scanStop(p, q, '', '%');
        const end = r > p ? r : q;
        if (!/^[0-9A-Fa-f:.]+$/.test(this.input.slice(p, end)) || !this.input.slice(p, end).includes(':')) {
          this.failExpecting('IPv6 address', p);
        }
        if (r > p && r < q) {
          if (r + 1 === q) this.fail('scope id expected');
          this.checkChars(r + 1, q, SCOPE_ID, 'scope id');
        }
        this.host = this.input.slice(p - 1, q + 1);
        p = q + 1;
      } else {
        this.failExpecting('closing bracket for IPv6 address', q);
      }
    } else {
      q = this.parseIPv4Address(p, n);
      if (q <= p) q = this.parseHostname(p, n);
      p = q;
    }
    if (this.at(p, n, ':')) {
      p++;
      q = this.scan(p, n, C_DIGIT);
      if (q > p) {
        this.port = Number(this.input.slice(p, q));
        if (!Number.isSafeInteger(this.port) || this.port > 2147483647) this.fail('Malformed port number', p);
      }
      p = q;
    }
    if (p < n) this.failExpecting('port number', p);
    return p;
  }

  private parseIPv4Address(start: number, n: number): number {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/.exec(this.input.slice(start, n));
    if (!m || m.slice(1).some((b) => Number(b) > 255)) return -1;
    let p = start + m[0].length;
    // The digit/dot run must end there.
    if (p < n && /[0-9.]/.test(this.input[p]!)) return -1;
    if (p < n && this.input[p] !== ':') p = -1;
    if (p > start) this.host = this.input.slice(start, p);
    return p;
  }

  private parseHostname(start: number, n: number): number {
    let p = start;
    let q: number;
    let l = -1;
    do {
      q = this.scan(p, n, C_ALPHANUM);
      if (q <= p) break;
      l = p;
      p = q;
      q = this.scan(p, n, C_ALPHANUM_DASH);
      if (q > p) {
        if (this.input[q - 1] === '-') this.fail('Illegal character in hostname', q - 1);
        p = q;
      }
      q = this.at(p, n, '.') ? p + 1 : p;
      if (q <= p) break;
      p = q;
    } while (p < n);
    if (p < n && !this.at(p, n, ':')) this.fail('Illegal character in hostname', p);
    if (l < 0) this.failExpecting('hostname', start);
    if (l > start && !C_ALPHA.chars.has(this.input[l]!)) this.fail('Illegal character in hostname', l);
    this.host = this.input.slice(start, p);
    return p;
  }
}

/** URI.create(s) (throws JavaUriSyntaxError where Java throws IllegalArgumentException). */
export function javaUriCreate(s: string): JavaUri {
  const p = new Parser(s);
  p.parse(false);
  return {
    scheme: p.scheme,
    host: p.host,
    port: p.port,
    rawAuthority: p.authority,
    rawUserInfo: p.userInfo,
    rawPath: p.opaque ? null : p.path,
    rawQuery: p.query,
    rawFragment: p.fragment,
    opaque: p.opaque,
  };
}

const utf8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** URI.decode(s): getPath()/getQuery() from the raw forms. Runs of %XX are UTF-8 (malformed -> U+FFFD). */
export function javaUriDecode(s: string | null): string | null {
  if (s == null || !s.includes('%')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '%') {
      out += s[i++];
      continue;
    }
    const bytes: number[] = [];
    while (i < s.length && s[i] === '%') {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
    }
    out += utf8.decode(new Uint8Array(bytes));
  }
  return out;
}

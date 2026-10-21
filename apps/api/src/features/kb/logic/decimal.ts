// java.math.BigDecimal, the subset the kb logic uses: exact unscaled bigint +
// scale, with BigDecimal's scale rules (add: max scale, multiply: sum of scales),
// setScale/divide with a RoundingMode, compareTo ignoring scale, and toString in
// BigDecimal's format. Never a float in between.
//
// Serializes like Jackson writes a BigDecimal (toString(), e.g. 5.00, 1E+1) via
// toJSON + JSON.rawJSON, so a Dec placed in a JSON tree prints as Java would.

import { javaDoubleString } from '../../../lib/json';

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'HALF_DOWN' | 'DOWN' | 'UP' | 'FLOOR' | 'CEILING';

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

export class Dec {
  static readonly ZERO = new Dec(0n, 0);
  static readonly ONE = new Dec(1n, 0);

  private constructor(readonly unscaled: bigint, readonly scale: number) {}

  static of(unscaled: bigint, scale = 0): Dec {
    return new Dec(unscaled, scale);
  }

  /** new BigDecimal(String): [sign] digits [. digits] [e|E [sign] digits]; throws NumberFormatException otherwise. */
  static parse(s: string): Dec {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) throw new NumberFormatError(s);
    const int = m[2] ?? '';
    const frac = m[3] ?? '';
    const exp = m[4] ? Number(m[4]) : 0;
    let unscaled = BigInt((int + frac) || '0');
    if (m[1] === '-') unscaled = -unscaled;
    return new Dec(unscaled, frac.length - exp);
  }

  /** BigDecimal.valueOf(long). */
  static fromInt(n: number | bigint): Dec {
    if (typeof n === 'number' && !Number.isInteger(n)) throw new Error(`not an integer: ${n}`);
    return new Dec(BigInt(n), 0);
  }

  /** BigDecimal.valueOf(double): the Double.toString digits (what Jackson's DoubleNode.decimalValue() returns). */
  static fromDouble(d: number): Dec {
    if (!Number.isFinite(d)) throw new NumberFormatError(String(d));
    return Dec.parse(javaDoubleString(d));
  }

  signum(): number {
    return this.unscaled > 0n ? 1 : this.unscaled < 0n ? -1 : 0;
  }

  negate(): Dec {
    return new Dec(-this.unscaled, this.scale);
  }

  abs(): Dec {
    return this.unscaled < 0n ? this.negate() : this;
  }

  private static align(a: Dec, b: Dec): [bigint, bigint, number] {
    if (a.scale === b.scale) return [a.unscaled, b.unscaled, a.scale];
    if (a.scale > b.scale) return [a.unscaled, b.unscaled * pow10(a.scale - b.scale), a.scale];
    return [a.unscaled * pow10(b.scale - a.scale), b.unscaled, b.scale];
  }

  add(o: Dec): Dec {
    const [x, y, s] = Dec.align(this, o);
    return new Dec(x + y, s);
  }

  subtract(o: Dec): Dec {
    const [x, y, s] = Dec.align(this, o);
    return new Dec(x - y, s);
  }

  multiply(o: Dec): Dec {
    return new Dec(this.unscaled * o.unscaled, this.scale + o.scale);
  }

  compareTo(o: Dec): number {
    const [x, y] = Dec.align(this, o);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /** compareTo(o) == 0 (AssertJ isEqualByComparingTo). */
  eq(o: Dec): boolean {
    return this.compareTo(o) === 0;
  }

  lt(o: Dec): boolean {
    return this.compareTo(o) < 0;
  }

  max(o: Dec): Dec {
    return this.compareTo(o) >= 0 ? this : o;
  }

  min(o: Dec): Dec {
    return this.compareTo(o) <= 0 ? this : o;
  }

  /** setScale(newScale, mode). */
  setScale(newScale: number, mode: RoundingMode = 'HALF_UP'): Dec {
    if (newScale === this.scale) return this;
    if (newScale > this.scale) return new Dec(this.unscaled * pow10(newScale - this.scale), newScale);
    return new Dec(roundDiv(this.unscaled, pow10(this.scale - newScale), mode), newScale);
  }

  /** divide(divisor, scale, mode). */
  divide(o: Dec, scale: number, mode: RoundingMode = 'HALF_UP'): Dec {
    if (o.unscaled === 0n) throw new Error('Division by zero');
    // value = (a / 10^as) / (b / 10^bs); result unscaled = a * 10^(scale + bs - as) / b
    const shift = scale + o.scale - this.scale;
    let num = this.unscaled;
    let den = o.unscaled;
    if (shift >= 0) num *= pow10(shift);
    else den *= pow10(-shift);
    return new Dec(roundDiv(num, den, mode), scale);
  }

  /** stripTrailingZeros() (zero becomes BigDecimal.ZERO, scale 0). */
  stripTrailingZeros(): Dec {
    if (this.unscaled === 0n) return Dec.ZERO;
    let u = this.unscaled;
    let s = this.scale;
    while (u % TEN === 0n) {
      u /= TEN;
      s--;
    }
    return new Dec(u, s);
  }

  /** BigDecimal.toString(): plain unless scale < 0 or the adjusted exponent < -6. */
  toString(): string {
    const neg = this.unscaled < 0n;
    const digits = (neg ? -this.unscaled : this.unscaled).toString();
    const sign = neg ? '-' : '';
    if (this.scale === 0) return sign + digits;
    const adjusted = -this.scale + (digits.length - 1);
    if (this.scale > 0 && adjusted >= -6) {
      const padded = digits.padStart(this.scale + 1, '0');
      const cut = padded.length - this.scale;
      return `${sign}${padded.slice(0, cut)}.${padded.slice(cut)}`;
    }
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mant}E${adjusted >= 0 ? '+' : ''}${adjusted}`;
  }

  /** toPlainString(). */
  toPlainString(): string {
    if (this.scale <= 0) return (this.unscaled * pow10(-this.scale)).toString();
    const neg = this.unscaled < 0n;
    const digits = (neg ? -this.unscaled : this.unscaled).toString().padStart(this.scale + 1, '0');
    const cut = digits.length - this.scale;
    return `${neg ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
  }

  /** doubleValue() (correctly rounded, like Java). */
  toNumber(): number {
    return Number(this.toString());
  }

  /** longValue() / intValue() truncation toward zero (as a number; callers keep it in range). */
  toIntegerTrunc(): number {
    return Number(this.setScale(0, 'DOWN').unscaled);
  }

  toJSON(): unknown {
    return JSON.rawJSON(this.toString());
  }
}

export class NumberFormatError extends Error {
  constructor(s: string) {
    super(`Character array is missing "exponent" mark 'e' or 'E'. (${s})`);
    this.name = 'NumberFormatException';
  }
}

/** num / den rounded to an integer with `mode`. */
function roundDiv(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const q = num / den; // truncates toward zero
  const r = num - q * den;
  if (r === 0n) return q;
  const sign = num < 0n ? -1n : 1n;
  const twice = 2n * (r < 0n ? -r : r);
  const away = q + sign;
  switch (mode) {
    case 'DOWN':
      return q;
    case 'UP':
      return away;
    case 'FLOOR':
      return sign < 0n ? away : q;
    case 'CEILING':
      return sign > 0n ? away : q;
    case 'HALF_UP':
      return twice >= den ? away : q;
    case 'HALF_DOWN':
      return twice > den ? away : q;
    case 'HALF_EVEN':
      if (twice > den) return away;
      if (twice < den) return q;
      return q % 2n === 0n ? q : away;
  }
}

/** new BigDecimal(s) shorthand. */
export const dec = (s: string): Dec => Dec.parse(s);

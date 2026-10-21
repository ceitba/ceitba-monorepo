// java.util.UUID.fromString / toString. A UUID is kept as its canonical
// lowercase string (what UUID.toString() prints), so `===` is UUID.equals.

export type Uuid = string;

const MAX_LONG = (1n << 63n) - 1n;

// Long.parseLong(s, begin, end, 16): optional sign, at least one hex digit, fits a long.
function parseHexLong(s: string): bigint {
  const m = /^([+-]?)([0-9a-fA-F]+)$/.exec(s);
  if (!m) throw new Error(`For input string: "${s}" under radix 16`);
  const v = BigInt('0x' + m[2]!);
  const signed = m[1] === '-' ? -v : v;
  if (signed > MAX_LONG || signed < -MAX_LONG - 1n) throw new Error(`For input string: "${s}" under radix 16`);
  return signed;
}

/**
 * UUID.fromString: at most 36 chars, exactly four dashes, each group a hex long
 * masked to its width (so "1-2-3-4-5" is 00000001-0002-0003-0004-000000000005).
 * Returns null where Java throws IllegalArgumentException. Only ASCII hex digits
 * are accepted (Java's slow path would also take other Unicode digits).
 */
export function parseUuid(name: string): Uuid | null {
  if (name.length > 36) return null;
  const d1 = name.indexOf('-');
  const d2 = name.indexOf('-', d1 + 1);
  const d3 = name.indexOf('-', d2 + 1);
  const d4 = name.indexOf('-', d3 + 1);
  const d5 = name.indexOf('-', d4 + 1);
  if (d1 < 0 || d2 < 0 || d3 < 0 || d4 < 0 || d5 >= 0) return null;
  try {
    const g = [
      [name.substring(0, d1), 32],
      [name.substring(d1 + 1, d2), 16],
      [name.substring(d2 + 1, d3), 16],
      [name.substring(d3 + 1, d4), 16],
      [name.substring(d4 + 1), 48],
    ] as const;
    return g.map(([s, bits]) => BigInt.asUintN(bits, parseHexLong(s)).toString(16).padStart(bits / 4, '0')).join('-');
  } catch {
    return null;
  }
}

/** UUID.fromString that throws (IllegalArgumentException) like Java. */
export function uuidOf(name: string): Uuid {
  const u = parseUuid(name);
  if (u == null) throw new Error(`Invalid UUID string: ${name}`);
  return u;
}

/** UUID.randomUUID(). */
export const randomUuid = (): Uuid => crypto.randomUUID();

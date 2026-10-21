// Column and body value conversions with Hibernate/Jackson semantics (the same rules as
// src/features/kb-pipeline/db/values.ts, kept here so kb-admin does not depend on that
// file's internals):
//   - TIMESTAMPTZ read from the database is an OffsetDateTime at UTC (prints ...Z);
//     one computed with OffsetDateTime.now(clock) carries the ART offset (-03:00);
//   - NUMERIC is a BigDecimal with the column's scale (Dec);
//   - JSON (request bodies, jsonb columns) is read like ObjectMapper.readTree: integral
//     numbers are ints, any number with a fraction or exponent a DoubleNode (JDouble,
//     so 5.0 prints 5.0), never a BigDecimal.

import { parsePgTimestamp } from '../../lib/time';
import { Dec } from '../kb/logic/decimal';
import { JDouble, nodeToString, type JsonValue, type Node } from '../kb/logic/jsonNode';
import { ART_ZONE, Odt, odtFromMicros, offsetId } from '../kb/logic/odt';
import type { Deps } from '../../deps';

export function odtOf(pg: string | null | undefined): Odt | null {
  if (pg == null) return null;
  const us = parsePgTimestamp(pg);
  const sec = Math.floor(us / 1_000_000);
  return Odt.ofEpoch(sec, (us - sec * 1_000_000) * 1000, 0);
}

/** An Odt as a timestamptz bind value (ISO text Postgres parses losslessly). */
export const pgTime = (o: Odt | null): string | null => (o == null ? null : o.toString());

export const decOf = (pg: string | null | undefined): Dec | null => (pg == null ? null : Dec.parse(pg));
export const pgDec = (d: Dec | null): string | null => (d == null ? null : d.toPlainString());

/** ObjectMapper.readTree with Spring Boot's defaults. Throws SyntaxError on bad JSON. */
export function readJacksonTree(text: string): JsonValue {
  return JSON.parse(text, (_k, v, ctx?: { source?: string }) => {
    if (typeof v === 'number' && ctx?.source !== undefined && /[.eE]/.test(ctx.source)) return new JDouble(v);
    return v;
  }) as JsonValue;
}

export const jsonOf = (pg: string | null | undefined): JsonValue | null => (pg == null ? null : readJacksonTree(pg));

/** A tree as jsonb text (Jackson's compact form). */
export const pgJson = (n: Node): string | null => (n === undefined || n === null ? null : nodeToString(n));

/** OffsetDateTime.now(clock): the business clock at ART's offset. */
export const nowOdt = (deps: Deps): Odt => odtFromMicros(deps.clock.now(), ART_ZONE);

/** Odt minus whole days / minutes (OffsetDateTime.minusDays keeps the offset; ART has no DST). */
export const minusSeconds = (o: Odt, s: number): Odt => o.plusSeconds(-s);

/**
 * Jackson's OffsetDateTime (ISO_OFFSET_DATE_TIME): seconds always, the fraction with
 * trailing zeros stripped, the value's own offset (Odt.toString() is OffsetDateTime.toString(),
 * which drops ":00" seconds: only for values Java builds with toString()).
 */
export function odtJson(o: Odt | null | undefined): string | null {
  if (o == null) return null;
  const l = o.local();
  const p = (x: number, w = 2) => String(x).padStart(w, '0');
  let s = `${p(l.year, 4)}-${p(l.month)}-${p(l.day)}T${p(l.hour)}:${p(l.minute)}:${p(l.second)}`;
  if (o.nano > 0) s += '.' + p(o.nano, 9).replace(/0+$/, '');
  return s + offsetId(o.offsetSeconds);
}

/**
 * A DTO ready for the router's Jackson writer: every Odt becomes its Jackson text
 * (odtJson); Dec / JDouble / plain values are kept (they serialize themselves).
 */
export function jackson<T>(v: T): T {
  return conv(v) as T;
}

function conv(v: unknown): unknown {
  if (v instanceof Odt) return odtJson(v);
  if (v == null || typeof v !== 'object' || v instanceof Dec || v instanceof JDouble) return v;
  if ((JSON as unknown as { isRawJSON(x: unknown): boolean }).isRawJSON(v)) return v;
  if (Array.isArray(v)) return v.map(conv);
  if (v instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of v) o[String(k)] = conv(x);
    return o;
  }
  if ('toJSON' in v && typeof (v as { toJSON: unknown }).toJSON === 'function' && Object.getPrototypeOf(v) !== Object.prototype) return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = conv(x);
  return o;
}

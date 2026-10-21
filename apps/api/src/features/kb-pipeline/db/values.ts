// Column value conversions between Postgres text and the kb logic's Java-like
// types (Odt, Dec, Jackson trees), with Hibernate's semantics:
//   - TIMESTAMPTZ read from the database is an OffsetDateTime at UTC (Z);
//   - NUMERIC is a BigDecimal with the column's scale;
//   - JSONB is read the way Hibernate's Jackson FormatMapper reads it: an
//     integral number is an IntNode/LongNode, any number with a fraction or
//     exponent a DoubleNode (5.00 -> 5.0), never a BigDecimal.

import { javaDoubleString } from '../../../lib/json';
import { readJacksonTree } from '../../../lib/jackson';
import { parsePgTimestamp } from '../../../lib/time';
import { Dec } from '../../kb/logic/decimal';
import { nodeToString, type JsonValue, type Node } from '../../kb/logic/jsonNode';
import { Odt } from '../../kb/logic/odt';

/** A TIMESTAMPTZ text value as Hibernate maps it (UTC). */
export function odtOf(pg: string | null | undefined): Odt | null {
  if (pg == null) return null;
  const us = parsePgTimestamp(pg);
  const sec = Math.floor(us / 1_000_000);
  return Odt.ofEpoch(sec, (us - sec * 1_000_000) * 1000, 0);
}

/** An Odt as a bind value Postgres parses losslessly (microseconds). */
export function pgTime(o: Odt | null): string | null {
  return o == null ? null : o.toString();
}

/** Microseconds since the epoch of an Odt (truncated to micros). */
export function microsOf(o: Odt): number {
  return o.epochSecond * 1_000_000 + Math.floor(o.nano / 1000);
}

export function decOf(pg: string | null | undefined): Dec | null {
  return pg == null ? null : Dec.parse(pg);
}

export function pgDec(d: Dec | null): string | null {
  return d == null ? null : d.toPlainString();
}

export { readJacksonTree };

export function jsonOf(pg: string | null | undefined): JsonValue | null {
  return pg == null ? null : readJacksonTree<JsonValue>(pg);
}

/** A tree as jsonb text (Jackson's compact form); a Java null field is SQL NULL. */
export function pgJson(n: Node | null): string | null {
  return n === undefined || n === null ? null : nodeToString(n);
}

export { javaDoubleString };

// SavedScheduleService.payloadChanged (apps/api/.../service/user/SavedScheduleService.java):
// payload_updated_at (digest staleness) moves only on a real change. Compared
// as canonical JSON (map keys sorted, recursively, by UTF-16 order like
// Jackson's ORDER_MAP_ENTRIES_BY_KEYS), so key order and Integer/Long are not
// changes; Integer 1 and Double 1.0 are (Java writes "1" vs "1.0"). The
// service compares Jackson-bound trees (jacksonTree.ts); plain JS values are
// accepted too (an integral number is an Integer, any other a Double).

import { writeJackson, type JNode } from '../../../lib/jackson';

export function toNode(v: unknown): JNode {
  if (v === null || v === undefined) return { t: 'null' };
  if (Array.isArray(v)) return { t: 'arr', items: v.map(toNode) };
  if (typeof v === 'object') return { t: 'obj', entries: Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toNode(x)]) };
  if (typeof v === 'string') return { t: 'str', v };
  if (typeof v === 'boolean') return { t: 'bool', v };
  if (typeof v === 'number') return Number.isInteger(v) ? { t: 'int', digits: String(v) } : { t: 'dbl', v };
  return { t: 'str', v: String(v) };
}

const EMPTY: JNode = { t: 'obj', entries: [] };
const canonical = (n: JNode | null) => writeJackson(n ?? EMPTY, true);

export function payloadChangedNodes(stored: JNode | null, incoming: JNode | null): boolean {
  return canonical(stored) !== canonical(incoming);
}

export function payloadChanged(stored: Record<string, unknown> | null | undefined,
                               incoming: Record<string, unknown> | null | undefined): boolean {
  return payloadChangedNodes(stored == null ? null : toNode(stored), incoming == null ? null : toNode(incoming));
}

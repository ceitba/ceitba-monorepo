// LinkedHashMap / TreeMap bodies keep their key order in Jackson. A JS object
// would move integer-like keys ("0", "1", ...) first, so ordered maps are
// built as Map and written here.

import { JSON_TYPE } from '../../../http/router';
import { toJavaJson } from '../../../lib/json';

/** Serializes nested Maps in iteration order; everything else through toJavaJson. */
export function linkedJsonText(value: unknown): string {
  if (value instanceof Map) {
    const parts: string[] = [];
    for (const [k, v] of value) parts.push(`${toJavaJson(String(k))}:${linkedJsonText(v)}`);
    return `{${parts.join(',')}}`;
  }
  if (Array.isArray(value) && value.some((v) => v instanceof Map)) return `[${value.map(linkedJsonText).join(',')}]`;
  return toJavaJson(value);
}

/** A 200 JSON response of an ordered map. */
export function linkedJson(value: unknown, status = 200): Response {
  return new Response(linkedJsonText(value), { status, headers: { 'Content-Type': JSON_TYPE } });
}

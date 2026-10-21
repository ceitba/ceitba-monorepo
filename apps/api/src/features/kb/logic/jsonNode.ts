// Jackson JsonNode semantics over plain JSON values, for the kb logic that
// walks LLM answers, probes and settings as trees.
//
//   Java MissingNode -> undefined, NullNode -> null, ObjectNode -> plain object,
//   ArrayNode -> array, BigDecimal values -> Dec (serializes as Java does).
//
// readTree keeps 25 vs 25.0 apart (IntNode vs DoubleNode: JDouble), like Jackson.

import { JDouble, readJacksonTree } from '../../../lib/jackson';
import { javaDoubleString, toJavaJson } from '../../../lib/json';
import { Dec } from './decimal';
import { javaTrim } from '../../../lib/javaCompat';


export { JDouble };

export type JsonValue = null | boolean | number | string | Dec | JDouble | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
/** A node as Jackson's path() returns it: undefined is MissingNode. */
export type Node = JsonValue | undefined;

export const isMissing = (n: Node): n is undefined => n === undefined;
export const isNull = (n: Node): n is null => n === null;
export const isArray = (n: Node): n is JsonValue[] => Array.isArray(n);
export const isObject = (n: Node): n is JsonObject =>
  typeof n === 'object' && n !== null && !Array.isArray(n) && !(n instanceof Dec) && !(n instanceof JDouble);
export const isTextual = (n: Node): n is string => typeof n === 'string';
export const isNumber = (n: Node): n is number | Dec | JDouble =>
  typeof n === 'number' || n instanceof Dec || n instanceof JDouble;
/** isIntegralNumber(): an int/long node (JSON.parse cannot tell 25 from 25.0: both count as integral here). */
export const isIntegralNumber = (n: Node): boolean => typeof n === 'number' && Number.isInteger(n);
export const isBoolean = (n: Node): n is boolean => typeof n === 'boolean';
export const isContainer = (n: Node): boolean => isArray(n) || isObject(n);

/** node.path(key) / node.path(index): MissingNode (undefined) when absent. */
export function path(n: Node, key: string | number): Node {
  if (typeof key === 'number') return isArray(n) ? n[key] : undefined;
  if (isObject(n)) return Object.prototype.hasOwnProperty.call(n, key) ? n[key] : undefined;
  return undefined;
}

/** node.path(a).path(b)... */
export function at(n: Node, ...keys: (string | number)[]): Node {
  let cur = n;
  for (const k of keys) cur = path(cur, k);
  return cur;
}

/** node.get(key) for ObjectNode/ArrayNode (null in Java when absent: here undefined). */
export const get = path;

/** ObjectNode.has(field) / ArrayNode.has(index): present, even as JSON null. */
export function has(n: Node, key: string | number): boolean {
  return path(n, key) !== undefined;
}

export function hasNonNull(n: Node, key: string | number): boolean {
  const v = path(n, key);
  return v !== undefined && v !== null;
}

/** JsonNode.size(): elements of a container, 0 otherwise. */
export function size(n: Node): number {
  if (isArray(n)) return n.length;
  if (isObject(n)) return Object.keys(n).length;
  return 0;
}

/** JsonNode.isEmpty(): size() == 0 (true for every value node too). */
export const isEmpty = (n: Node): boolean => size(n) === 0;

/** for (var x : node): array elements, object values, nothing for value nodes. */
export function elements(n: Node): JsonValue[] {
  if (isArray(n)) return n;
  if (isObject(n)) return Object.values(n);
  return [];
}

/** ObjectNode.fields() / properties(). */
export function fields(n: Node): [string, JsonValue][] {
  return isObject(n) ? Object.entries(n) : [];
}

function numberText(n: number): string {
  return Number.isInteger(n) && Math.abs(n) < 2 ** 63 ? String(BigInt(n)) : javaDoubleString(n);
}

/** asText() (no default): "" for missing/containers, "null" for NullNode. */
export function asText(n: Node): string;
/** asText(defaultValue): the default for missing and NullNode. */
export function asText(n: Node, def: string | null): string | null;
export function asText(n: Node, ...rest: [] | [string | null]): string | null {
  const hasDef = rest.length > 0;
  if (n === undefined) return hasDef ? rest[0]! : '';
  if (n === null) return hasDef ? rest[0]! : 'null';
  if (typeof n === 'string') return n;
  if (typeof n === 'boolean') return n ? 'true' : 'false';
  if (typeof n === 'number') return numberText(n);
  if (n instanceof Dec) return n.toString();
  if (n instanceof JDouble) return javaDoubleString(n.value);
  return '';
}

/** asInt(defaultValue = 0): numbers truncated to int, numeric text parsed, booleans 1/0. */
export function asInt(n: Node, def = 0): number {
  if (n instanceof JDouble) return toInt32(n.value);
  if (typeof n === 'number') return toInt32(n);
  if (n instanceof Dec) return toInt32(n.toNumber());
  if (typeof n === 'boolean') return n ? 1 : 0;
  if (typeof n === 'string') return parseAsInt(n, def);
  return def;
}

/** asLong(defaultValue = 0). */
export function asLong(n: Node, def = 0): number {
  if (n instanceof JDouble) return Math.trunc(n.value);
  if (typeof n === 'number') return Math.trunc(n);
  if (n instanceof Dec) return n.toIntegerTrunc();
  if (typeof n === 'boolean') return n ? 1 : 0;
  if (typeof n === 'string') {
    const t = javaTrim(n);
    if (/^[+-]?\d+$/.test(t)) return Number(t);
    const d = Number(t);
    return t !== '' && Number.isFinite(d) ? Math.trunc(d) : def;
  }
  return def;
}

/** asDouble(defaultValue = 0.0). */
export function asDouble(n: Node, def = 0): number {
  if (n instanceof JDouble) return n.value;
  if (typeof n === 'number') return n;
  if (n instanceof Dec) return n.toNumber();
  if (typeof n === 'boolean') return n ? 1 : 0;
  if (typeof n === 'string') {
    const t = javaTrim(n);
    const d = Number(t);
    return t !== '' && !Number.isNaN(d) ? d : def;
  }
  return def;
}

/** asBoolean(defaultValue = false): booleans, "true"/"false" text (trimmed), ints != 0. */
export function asBoolean(n: Node, def = false): boolean {
  if (typeof n === 'boolean') return n;
  if (typeof n === 'string') {
    const t = javaTrim(n);
    if (t === 'true') return true;
    if (t === 'false') return false;
    return def;
  }
  if (typeof n === 'number' && Number.isInteger(n)) return n !== 0;
  return def;
}

/** canConvertToInt(): a number within int range. */
export function canConvertToInt(n: Node): boolean {
  if (n instanceof JDouble) return canConvertToInt(n.value);
  if (typeof n === 'number') return n >= -2147483648 && n <= 2147483647;
  if (n instanceof Dec) return canConvertToInt(n.toNumber());
  return false;
}

/** decimalValue(): BigDecimal.valueOf(double) for doubles, exact for ints; 0 for non-numbers. */
export function decimalValue(n: Node): Dec {
  if (n instanceof Dec) return n;
  if (n instanceof JDouble) return Dec.fromDouble(n.value);
  if (typeof n === 'number') return Number.isInteger(n) ? Dec.fromInt(n) : Dec.fromDouble(n);
  return Dec.ZERO;
}

function toInt32(d: number): number {
  if (Number.isNaN(d)) return 0;
  if (d >= 2147483647) return 2147483647;
  if (d <= -2147483648) return -2147483648;
  return Math.trunc(d);
}

// NumberInput.parseAsInt(String, int): trimmed, optional sign, digits; else via double.
function parseAsInt(s: string, def: number): number {
  const t = javaTrim(s);
  if (t === '') return def;
  if (/^[+-]?\d+$/.test(t)) {
    const v = Number(t);
    if (v >= -2147483648 && v <= 2147483647) return v;
  }
  const d = Number(t);
  return Number.isNaN(d) || t === '' ? def : toInt32(d);
}

/** JsonNode.deepCopy(). */
export function deepCopy<T extends Node>(n: T): T {
  if (isArray(n)) return n.map((x) => deepCopy(x)) as T;
  if (isObject(n)) {
    const o: JsonObject = {};
    for (const [k, v] of Object.entries(n)) o[k] = deepCopy(v);
    return o as T;
  }
  return n;
}

/** JsonNode.toString(): compact JSON as Jackson writes it. MissingNode prints "". */
export function nodeToString(n: Node): string {
  if (n === undefined) return '';
  return toJavaJson(n);
}

/** ObjectMapper.readTree(String) (src/lib/jackson.ts). */
export function readTree(text: string): JsonValue {
  return readJacksonTree<JsonValue>(text);
}

/** JsonNode.equals: structural equality (numbers by value; Dec by unscaled+scale like BigDecimal.equals). */
export function nodeEquals(a: Node, b: Node): boolean {
  if (a === b) return true;
  if (a instanceof JDouble || b instanceof JDouble) {
    return a instanceof JDouble && b instanceof JDouble && a.value === b.value;
  }
  if (a instanceof Dec || b instanceof Dec) {
    return a instanceof Dec && b instanceof Dec && a.unscaled === b.unscaled && a.scale === b.scale;
  }
  if (isArray(a) && isArray(b)) return a.length === b.length && a.every((x, i) => nodeEquals(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && nodeEquals(a[k], b[k]));
  }
  return false;
}

/**
 * writerWithDefaultPrettyPrinter(): Jackson's DefaultPrettyPrinter layout:
 * objects one entry per line, 2-space indent, `"key" : value`, `{ }` when empty;
 * arrays inline `[ a, b ]`, `[ ]` when empty (objects inside keep their nesting).
 */
export function prettyJackson(v: Node): string {
  const out: string[] = [];
  const write = (n: JsonValue, nesting: number): void => {
    if (isArray(n)) {
      if (n.length === 0) {
        out.push('[ ]');
        return;
      }
      out.push('[ ');
      n.forEach((x, i) => {
        if (i > 0) out.push(', ');
        write(x, nesting);
      });
      out.push(' ]');
      return;
    }
    if (isObject(n)) {
      const keys = Object.keys(n);
      if (keys.length === 0) {
        out.push('{ }');
        return;
      }
      out.push('{');
      keys.forEach((k, i) => {
        out.push(i > 0 ? ',\n' : '\n', '  '.repeat(nesting + 1), toJavaJson(k), ' : ');
        write(n[k]!, nesting + 1);
      });
      out.push('\n', '  '.repeat(nesting), '}');
      return;
    }
    out.push(toJavaJson(n));
  };
  if (v === undefined) return '';
  write(v, 0);
  return out.join('');
}

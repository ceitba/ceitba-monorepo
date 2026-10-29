// Jackson's JSON reading and writing where a plain JS value is not enough:
//
// - readJacksonTree: ObjectMapper.readTree with Spring Boot's defaults (no
//   USE_BIG_DECIMAL_FOR_FLOATS): integral numbers stay numbers, any number with a
//   fraction or exponent is a DoubleNode (JDouble), so `5.0` and `5` stay apart.
// - JNode / parseJackson / writeJackson: a value bound into Map<String, Object>
//   with its key order kept exactly (JS objects move integer-like keys first),
//   integers as exact digits, decimals as a Java Double. Echoes request payloads
//   byte for byte (saved schedules).
// - jacksonFromJsonbText: a `Map<String, Object>` jsonb column read by Hibernate's
//   Jackson format mapper and written back (Postgres key order, Double.toString
//   numbers), from the column's text; RawJsonText + jsonWithRaw splice such
//   pre-rendered fragments into a response.

import { javaDoubleString, toJavaJson } from './json';

/**
 * A Java double in a tree (DoubleNode, ObjectNode.put(String, double)): Jackson writes it
 * with Double.toString (0.5, 1.0, 1.0E-4), which a plain JS number cannot carry.
 */
export class JDouble {
  constructor(readonly value: number) {}
  toJSON(): unknown {
    return JSON.rawJSON(javaDoubleString(this.value));
  }
}

/** ObjectMapper.readTree: fractional numbers become JDouble, integers stay numbers. Throws SyntaxError on bad JSON. */
export function readJacksonTree<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v, ctx?: { source?: string }) => {
    if (typeof v === 'number' && ctx?.source !== undefined && /[.eE]/.test(ctx.source)) return new JDouble(v);
    return v;
  }) as T;
}

// ------------------------------------------------------------- order-preserving trees

export type JNode =
  | { t: 'obj'; entries: [string, JNode][] }
  | { t: 'arr'; items: JNode[] }
  | { t: 'str'; v: string }
  | { t: 'int'; digits: string }
  | { t: 'dbl'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'null' };

export class JsonSyntaxError extends Error {}

/** Parses JSON text (RFC 8259, like Jackson's default parser). Duplicate keys: last value, first position. */
export function parseJackson(text: string): JNode {
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const fail = (): never => { throw new JsonSyntaxError(`Invalid JSON at ${i}`); };
  const value = (): JNode => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      const entries: [string, JNode][] = [];
      const index = new Map<string, number>();
      ws();
      if (text[i] === '}') { i++; return { t: 'obj', entries }; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const k = str();
        ws();
        if (text[i] !== ':') fail();
        i++;
        const v = value();
        const at = index.get(k);
        if (at === undefined) { index.set(k, entries.length); entries.push([k, v]); } else entries[at]![1] = v;
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { t: 'obj', entries }; }
        fail();
      }
    }
    if (ch === '[') {
      i++;
      const items: JNode[] = [];
      ws();
      if (text[i] === ']') { i++; return { t: 'arr', items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { t: 'arr', items }; }
        fail();
      }
    }
    if (ch === '"') return { t: 'str', v: str() };
    if (text.startsWith('true', i)) { i += 4; return { t: 'bool', v: true }; }
    if (text.startsWith('false', i)) { i += 5; return { t: 'bool', v: false }; }
    if (text.startsWith('null', i)) { i += 4; return { t: 'null' }; }
    const m = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) return fail();
    i += m[0].length;
    if (m[1] === undefined && m[2] === undefined) {
      // Integer/Long/BigInteger: the value's digits ("-0" is Integer 0).
      const neg = m[0].startsWith('-');
      const digits = m[0].replace(/^-/, '');
      return { t: 'int', digits: neg && digits !== '0' ? `-${digits}` : digits };
    }
    return { t: 'dbl', v: Number(m[0]) };
  };
  const str = (): string => {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail();
      const c = text[i]!;
      if (c === '"') { i++; return out; }
      if (c === '\\') {
        const e = text[i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (e !== undefined && e in map) {
          out += map[e];
          i += 2;
        } else fail();
        continue;
      }
      if (c < ' ') fail();
      out += c;
      i++;
    }
  };
  const v = value();
  ws();
  if (i !== text.length) fail();
  return v;
}

const UPPER_U = /(?<!\\)((?:\\\\)*)\\u([0-9a-f]{4})/g;
const jsonString = (s: string) => {
  const j = JSON.stringify(s);
  return j.includes('\\u') ? j.replace(UPPER_U, (_m, bs: string, hex: string) => `${bs}\\u${hex.toUpperCase()}`) : j;
};

/** Jackson's serialization of the bound value. `sortKeys` = ORDER_MAP_ENTRIES_BY_KEYS (natural String order). */
export function writeJackson(n: JNode, sortKeys = false): string {
  switch (n.t) {
    case 'obj': {
      const es = sortKeys ? [...n.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : n.entries;
      return `{${es.map(([k, v]) => `${jsonString(k)}:${writeJackson(v, sortKeys)}`).join(',')}}`;
    }
    case 'arr': return `[${n.items.map((v) => writeJackson(v, sortKeys)).join(',')}]`;
    case 'str': return jsonString(n.v);
    case 'int': return n.digits;
    case 'dbl': return javaDoubleString(n.v);
    case 'bool': return n.v ? 'true' : 'false';
    case 'null': return 'null';
  }
}

/** The node of `key` in an object node (null when absent or not an object). */
export function field(n: JNode, key: string): JNode | null {
  if (n.t !== 'obj') return null;
  return n.entries.find(([k]) => k === key)?.[1] ?? null;
}

/**
 * toJavaJson(value) with the string placeholders in `raw` replaced by raw
 * JSON text (Bun's JSON.rawJSON only takes primitives, so objects/arrays are
 * spliced in after serialization).
 */
export function spliceRawJson(json: string, raw: Map<string, string>): string {
  let out = json;
  for (const [token, text] of raw) out = out.replace(JSON.stringify(token), () => text);
  return out;
}

// ------------------------------------------------------------- jsonb columns

/** Jackson's rendering of a jsonb value, from Postgres' text output (`col::text`). */
export function jacksonFromJsonbText(pg: string): string {
  let out = '';
  let i = 0;
  const n = pg.length;
  while (i < n) {
    const ch = pg[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < n && pg[j] !== '"') j += pg[j] === '\\' ? 2 : 1;
      out += toJavaJson(JSON.parse(pg.slice(i, j + 1)) as string);
      i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(pg[j]!)) j++;
      const tok = pg.slice(i, j);
      if (/[.eE]/.test(tok)) out += javaDoubleString(Number(tok));
      else out += /^-0+$/.test(tok) ? '0' : tok;
      i = j;
    } else if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
      i++; // Jackson writes compact JSON
    } else {
      out += ch; // { } [ ] : , and the letters of true/false/null
      i++;
    }
  }
  return out;
}

/** A pre-rendered JSON fragment inside a response body (see `jsonWithRaw`). */
export class RawJsonText {
  constructor(readonly text: string) {}
}

/**
 * Like returning `body` from a handler, but RawJsonText values are written
 * verbatim (JSON.rawJSON only takes primitives).
 */
export function jsonWithRaw(body: unknown, status = 200): Response {
  const nonce = crypto.randomUUID();
  const raws: string[] = [];
  const marker = (i: number) => `\u0000raw-${nonce}-${i}\u0000`;
  const walk = (v: unknown): unknown => {
    if (v instanceof RawJsonText) {
      raws.push(v.text);
      return marker(raws.length - 1);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  let text = toJavaJson(walk(body));
  raws.forEach((r, i) => { text = text.replace(toJavaJson(marker(i)), () => r); });
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}

// A JSON value as Jackson binds it into Map<String, Object> (saved-schedule
// payloads, SavedScheduleService): key order kept exactly (JS objects move
// integer-like keys first), integers as BigInteger-exact digits, decimals as a
// Java Double (`1.0`, `1.5E-7`, `100.0` for `1E2`). Used to echo a request
// payload byte-for-byte like Jackson, to read jsonb text back like Hibernate's
// Jackson format mapper, and for the canonical comparison of payloadChanged.

import { javaDoubleString } from '../../../lib/json';

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

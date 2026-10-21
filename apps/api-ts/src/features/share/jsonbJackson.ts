// A JSONB column mapped as `Map<String, Object>` (@JdbcTypeCode(SqlTypes.JSON))
// and written back by Jackson: Hibernate parses the column text with Jackson into
// LinkedHashMaps (key order = Postgres' jsonb order: shorter keys first), ints
// stay ints and every decimal becomes a Double (`1.50` -> `1.5`, `0.0000001` ->
// `1.0E-7`). A JS object cannot carry that (integer-like keys such as "10" move
// to the front, `1.0` prints `1`), so the payload is re-rendered from the column
// text, and spliced into the response JSON.
//
// Used for SavedSchedule.payload in share sessions; the same applies to any
// other `Map<String, Object>` jsonb column (saved schedules themselves).

import { json as jsonResponse } from '../../http/router';
import { javaDoubleString, toJavaJson } from '../../lib/json';

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
  const res = jsonResponse(null, status);
  return new Response(text, { status, headers: res.headers });
}

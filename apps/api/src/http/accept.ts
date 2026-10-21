// Content negotiation for the routes that declare `produces` (Spring's @GetMapping(produces = ...)): the two HTML
// previews. Spring matched Accept at handler mapping, before the handler ran, ignoring `q` (a listed type is
// acceptable even with q=0). No match -> HttpMediaTypeNotAcceptableException: 406 with `Accept: <produces>`, and the
// error body written as JSON when the Accept admits JSON (else empty). An unparseable Accept is a 406 too.
// JSON routes ignore Accept (contract/COMPATIBILITY.md "Content negotiation").

interface Range { type: string; subtype: string }

/** MediaType.parseMediaTypes; null when the header is not a list of media types. */
export function parseAccept(header: string): Range[] | null {
  const out: Range[] = [];
  for (const part of header.split(',')) {
    const t = part.split(';')[0]!.trim().toLowerCase();
    if (t === '') continue;
    if (t === '*') { out.push({ type: '*', subtype: '*' }); continue; }
    const m = /^([a-z0-9!#$%&'*+.^_`|~-]+)\/([a-z0-9!#$%&'*+.^_`|~-]+)$/.exec(t);
    if (!m || (m[1] === '*' && m[2] !== '*')) return null;
    out.push({ type: m[1]!, subtype: m[2]! });
  }
  return out;
}

function compatible(r: Range, type: string, subtype: string): boolean {
  if (r.type === '*') return true;
  if (r.type !== type) return false;
  if (r.subtype === '*' || r.subtype === subtype) return true;
  // application/*+json vs application/problem+json
  const suffix = (s: string) => (s.includes('+') ? s.slice(s.lastIndexOf('+') + 1) : null);
  return (r.subtype.startsWith('*+') && suffix(subtype) === r.subtype.slice(2)) || (subtype.startsWith('*+') && suffix(r.subtype) === subtype.slice(2));
}

const wildcard = (r: Range) => (r.type === '*' ? 2 : r.subtype === '*' || r.subtype.startsWith('*+') ? 1 : 0);

/** The type Jackson would write the error body as (application/json, application/*+json), or null. */
function jsonTypeFor(ranges: Range[]): string | null {
  for (const r of [...ranges].sort((a, b) => wildcard(a) - wildcard(b))) {
    if (r.type === 'application' && (r.subtype === 'json' || /^[^*+]+\+json$/.test(r.subtype))) return `application/${r.subtype}`;
    if (compatible(r, 'application', 'json')) return 'application/json';
  }
  return null;
}

export type Negotiation = { ok: true } | { ok: false; jsonType: string | null };

/** Whether a route producing `produces` (type/subtype) may answer a request with this Accept header. */
export function negotiate(accept: string | undefined, produces: string): Negotiation {
  if (accept === undefined || accept.trim() === '') return { ok: true };
  const ranges = parseAccept(accept);
  if (ranges === null) return { ok: false, jsonType: null };
  if (ranges.length === 0) return { ok: true };
  const [type, subtype] = produces.split('/') as [string, string];
  if (ranges.some((r) => compatible(r, type, subtype))) return { ok: true };
  return { ok: false, jsonType: jsonTypeFor(ranges) };
}

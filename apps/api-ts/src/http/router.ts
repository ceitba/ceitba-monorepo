// Route definition for features (the Spring controller layer).
//
//   // src/features/<area>/routes.ts
//   export default defineRoutes((r, deps) => {
//     r.post('/v1/careers', { body: CreateCareerRequest, status: 201, summary: '...' }, async ({ body }) =>
//       service.create(body));
//   });
//
// Paths are written exactly like the Java mapping (full `/v1/...`, `{var}`,
// `{var:regex}`); the `/api` context path is added here. The wrapper does, in
// Spring's order: bind path variables / query params / the body (415, 400
// BadRequest, 400 ValidationError), resolve @CurrentUser when `currentUser`
// is set, evaluate the route's @PreAuthorize rule from policy.ts METHOD_RULES
// (403 AccessDenied), then call the handler and serialize its result with
// Jackson's rules (src/lib/json.ts).

import type { z } from 'zod';
import type { Deps } from '../deps';
import { toJavaJson } from '../lib/json';
import { evaluateRule } from './auth/checks';
import { optionalUser } from './auth/context';
import { METHOD_RULES, ruleKey, type Method } from './auth/policy';
import type { UserRow } from './auth/repo';
import type { AppContext } from './context';
import { AccessDeniedError, MalformedBodyError, UnsupportedMediaTypeError } from './errors';
import { resolveRequestLocale } from './locale';
import { bindBody, validateBody, type ParamSpec } from './validation';

export type ArgKind = 'params' | 'query' | 'body' | 'user';

export interface RouteSpec<
  P extends Record<string, ParamSpec<unknown>> = Record<string, ParamSpec<unknown>>,
  Q extends Record<string, ParamSpec<unknown>> = Record<string, ParamSpec<unknown>>,
  B extends z.ZodType | undefined = undefined,
> {
  /** Path variables (@PathVariable), by name. Unlisted variables are passed as raw strings. */
  params?: P;
  /** Query parameters (@RequestParam). */
  query?: Q;
  /** `@Valid @RequestBody` DTO schema (jv.object(...)). */
  body?: B;
  /** `@RequestBody` WITHOUT @Valid: bind only. */
  bodyValidation?: 'valid' | 'bindOnly';
  /** `@RequestBody(required = false)`: an absent body is null. */
  bodyOptional?: boolean;
  /**
   * Raw body (`@RequestBody String`): no Content-Type check, no JSON parsing. With `body` set
   * this is not needed: the handler gets the raw text of a validated JSON body in `rawBody`
   * too (to read it with src/lib/jacksonTree.ts when key order or number types matter).
   */
  rawBody?: boolean;
  /** `@CurrentUser User user`. */
  currentUser?: boolean;
  /** Java argument order when it matters (which 400/403 wins). Default params, query, body, user. */
  argOrder?: ArgKind[];
  /** Status for a plain returned value (@ResponseStatus). Default 200. */
  status?: number;
  /** OpenAPI. */
  summary?: string;
  tags?: string[];
  /** @Hidden. */
  hidden?: boolean;
}

type ParamValues<P> = { [K in keyof P]: P[K] extends ParamSpec<infer T> ? T : never };

export interface HandlerArgs<P, Q, B> {
  c: AppContext;
  deps: Deps;
  params: ParamValues<P> & Record<string, string>;
  query: ParamValues<Q>;
  /** The bound body (never null unless `bodyOptional`). */
  body: B extends z.ZodType ? NonNullable<z.output<B>> : undefined;
  /** The raw body text whenever the body was read (`rawBody`, or `body` after the JSON checks and validation). */
  rawBody: string | null;
  /** @CurrentUser (null for anonymous callers of public routes). */
  user: UserRow | null;
}

/** A handler returns a Response (helpers below) or a value serialized as JSON with `spec.status`. */
export type Handler<P, Q, B> = (args: HandlerArgs<P, Q, B>) => Promise<unknown> | unknown;

export interface RouteDef {
  method: Method;
  /** Spring path, e.g. /v1/careers/{id}. */
  path: string;
  spec: RouteSpec;
  handler: Handler<unknown, unknown, unknown>;
  feature: string;
}

export class RouteRegistrar {
  readonly routes: RouteDef[] = [];
  constructor(private readonly feature: string) {}

  private add(method: Method, path: string, spec: RouteSpec<any, any, any>, handler: Handler<any, any, any>) {
    if (!path.startsWith('/')) throw new Error(`Route path must start with / (${path})`);
    this.routes.push({ method, path, spec, handler, feature: this.feature });
  }

  get<P extends Record<string, ParamSpec<unknown>> = {}, Q extends Record<string, ParamSpec<unknown>> = {}, B extends z.ZodType | undefined = undefined>(path: string, spec: RouteSpec<P, Q, B>, h: Handler<P, Q, B>) { this.add('GET', path, spec, h); }
  post<P extends Record<string, ParamSpec<unknown>> = {}, Q extends Record<string, ParamSpec<unknown>> = {}, B extends z.ZodType | undefined = undefined>(path: string, spec: RouteSpec<P, Q, B>, h: Handler<P, Q, B>) { this.add('POST', path, spec, h); }
  put<P extends Record<string, ParamSpec<unknown>> = {}, Q extends Record<string, ParamSpec<unknown>> = {}, B extends z.ZodType | undefined = undefined>(path: string, spec: RouteSpec<P, Q, B>, h: Handler<P, Q, B>) { this.add('PUT', path, spec, h); }
  patch<P extends Record<string, ParamSpec<unknown>> = {}, Q extends Record<string, ParamSpec<unknown>> = {}, B extends z.ZodType | undefined = undefined>(path: string, spec: RouteSpec<P, Q, B>, h: Handler<P, Q, B>) { this.add('PATCH', path, spec, h); }
  delete<P extends Record<string, ParamSpec<unknown>> = {}, Q extends Record<string, ParamSpec<unknown>> = {}, B extends z.ZodType | undefined = undefined>(path: string, spec: RouteSpec<P, Q, B>, h: Handler<P, Q, B>) { this.add('DELETE', path, spec, h); }
}

export type RoutesModule = (r: RouteRegistrar, deps: Deps) => void | Promise<void>;
export const defineRoutes = (fn: RoutesModule): RoutesModule => fn;

// ------------------------------------------------------------- responses

export const JSON_TYPE = 'application/json';

/** A JSON response written like Spring (Content-Type application/json, Jackson formatting). */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(toJavaJson(body), { status, headers: { 'Content-Type': JSON_TYPE, ...headers } });
}

/** ResponseEntity.noContent() (no Content-Type). */
export function noContent(headers: HeadersInit = {}): Response {
  return new Response(null, { status: 204, headers });
}

/** 302 to `location` (ResponseEntity.status(FOUND).location(...)). */
export function found(location: string, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('Location', location);
  return new Response(null, { status: 302, headers: h });
}

/** ResponseEntity with no body and a status (e.g. notFound().build()). */
export function emptyStatus(status: number, headers: HeadersInit = {}): Response {
  return new Response(null, { status, headers });
}

// ------------------------------------------------------------- path patterns

/** `/v1/x/{id}/{rest:regex}` -> Hono `/api/v1/x/:id/:rest{regex}`. */
export function toHonoPath(springPath: string): string {
  const p = springPath.replace(/\{(\w+)(?::((?:[^{}]|\{[^{}]*\})*))?\}/g, (_m, name: string, re?: string) => (re ? `:${name}{${re}}` : `:${name}`));
  return `/api${p === '/' ? '/' : p}`;
}

/** RegExp of a Spring path (for 405/Allow computation). */
export function springPathRegExp(springPath: string): RegExp {
  let out = '';
  let last = 0;
  const re = /\{(\w+)(?::((?:[^{}]|\{[^{}]*\})*))?\}/g;
  for (const m of springPath.matchAll(re)) {
    out += springPath.slice(last, m.index).replace(/[.+?^${}()|[\]\\*]/g, '\\$&');
    out += m[2] ? `(?:${m[2]})` : '[^/]+';
    last = m.index! + m[0].length;
  }
  out += springPath.slice(last).replace(/[.+?^${}()|[\]\\*]/g, '\\$&');
  return new RegExp(`^${out}$`);
}

/** Spring's PathPattern specificity: fewer variables first, then longer literal text. */
export function compareSpecificity(a: string, b: string): number {
  const vars = (p: string) => (p.match(/\{/g) ?? []).length;
  const wild = (p: string) => (p.match(/\*/g) ?? []).length;
  return vars(a) - vars(b) || wild(a) - wild(b) || b.replace(/\{[^}]*\}/g, '').length - a.replace(/\{[^}]*\}/g, '').length;
}

// ------------------------------------------------------------- the wrapper

/**
 * The Content-Type as Spring reports it: MediaType.toString() (lower-case
 * type, params as given, `;` without spaces), plus `charset=UTF-8` when the
 * header has none (Boot's CharacterEncodingFilter forces the request encoding,
 * and ServletServerHttpRequest folds it into the content type).
 */
function normalizeMediaType(ct: string): string {
  const [type, ...params] = ct.split(';').map((s) => s.trim()).filter(Boolean);
  const ps = params.map((p) => p.replace(/\s*=\s*/, '='));
  if (!ps.some((p) => p.toLowerCase().startsWith('charset='))) ps.push('charset=UTF-8');
  return [type!.toLowerCase(), ...ps].join(';');
}

function isJsonCompatible(ct: string): boolean {
  const t = ct.split(';')[0]!.trim().toLowerCase();
  return t === 'application/json' || /^application\/[^/]+\+json$/.test(t) || t === '*/*' || t === 'application/*';
}

async function readBody(c: AppContext, spec: RouteSpec): Promise<{ raw: string | null; json: unknown }> {
  const text = await c.req.raw.text();
  if (spec.rawBody) return { raw: text, json: undefined };
  const ct = c.req.header('content-type');
  const empty = text.length === 0;
  if (!ct) {
    // No Content-Type and no body: Spring skips conversion ("required body missing").
    if (empty) {
      if (spec.bodyOptional) return { raw: text, json: null };
      throw new MalformedBodyError();
    }
    throw new UnsupportedMediaTypeError('application/octet-stream');
  }
  if (!isJsonCompatible(ct)) throw new UnsupportedMediaTypeError(normalizeMediaType(ct));
  if (empty) {
    if (spec.bodyOptional) return { raw: text, json: null };
    throw new MalformedBodyError();
  }
  try {
    return { raw: text, json: JSON.parse(text) };
  } catch {
    throw new MalformedBodyError();
  }
}

export function wrapHandler(route: RouteDef, deps: Deps) {
  const spec = route.spec;
  const rule = METHOD_RULES[ruleKey(route.method, route.path)];
  const order: ArgKind[] = spec.argOrder ?? ['params', 'query', 'body', 'user'];
  return async (c: AppContext): Promise<Response> => {
    const rawParams = c.req.param() as Record<string, string>;
    const params: Record<string, unknown> = { ...rawParams };
    const query: Record<string, unknown> = {};
    let body: unknown;
    let rawBody: string | null = null;
    let user: UserRow | null = null;
    for (const step of order) {
      if (step === 'params' && spec.params) {
        for (const [name, p] of Object.entries(spec.params)) params[name] = p.parse(rawParams[name], name);
      } else if (step === 'query' && spec.query) {
        for (const [name, p] of Object.entries(spec.query)) query[name] = p.parse(c.req.query(name), name);
      } else if (step === 'body' && (spec.body || spec.rawBody)) {
        const r = await readBody(c, spec);
        rawBody = r.raw;
        if (spec.body) {
          if (r.json === null && spec.bodyOptional) body = null;
          else body = spec.bodyValidation === 'bindOnly'
            ? bindBody(spec.body, r.json)
            : validateBody(spec.body, r.json, resolveRequestLocale(c.req.header('accept-language'), deps.config.server.defaultLocale));
        }
      } else if (step === 'user' && spec.currentUser) {
        user = await optionalUser(c);
      }
    }
    if (rule) {
      const ok = await evaluateRule(rule, { deps, principal: c.get('state').principal }, { params, body });
      if (!ok) throw new AccessDeniedError();
    }
    const result = await route.handler({ c, deps, params: params as never, query: query as never, body: body as never, rawBody, user });
    if (result instanceof Response) return result;
    // A void method / `return null` from a @ResponseBody method: empty body.
    if (result === undefined || result === null) return new Response(null, { status: spec.status ?? 200 });
    return json(result, spec.status ?? 200);
  };
}

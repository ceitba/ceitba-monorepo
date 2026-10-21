// The HTTP application: Tomcat's context path handling, the Spring Security
// chain (security.ts), Spring MVC routing (Hono) and GlobalExceptionHandler.
// Routes are discovered from src/features/*/routes.ts: feature agents never
// edit this file.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Deps } from '../deps';
import { isDataIntegrityViolation } from '../db/client';
import { toJavaJson } from '../lib/json';
import { systemNowMicros } from '../lib/time';
import type { AppContext, AppEnv, RequestState } from './context';
import { ApiError, CodedError, DataIntegrityViolationError, ExternalApiError, InternalServerError, MethodNotAllowedError, NoResourceFoundError } from './errors';
import { registerCoreRoutes, setRoutesProvider } from './core-routes';
import { IpRateLimiter, resolveClientIp } from './ratelimit';
import { compareSpecificity, RouteRegistrar, springPathRegExp, toHonoPath, wrapHandler, type RouteDef, type RoutesModule } from './router';
import { applySecurityHeaders, authenticateAndAuthorize, processCors, withVary } from './security';

const FEATURES_DIR = join(import.meta.dir, '..', 'features');

export interface App {
  /** Bun.serve's fetch (pass `server` to get the client IP). */
  fetch(req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response>;
  /** In-process requests for tests (`remoteAddr` defaults to 127.0.0.1). */
  request(pathOrReq: string | Request, init?: RequestInit, remoteAddr?: string): Promise<Response>;
  routes: RouteDef[];
}

/** Imports every src/features/<area>/routes.ts and collects its routes. */
export async function collectRoutes(deps: Deps, featuresDir = FEATURES_DIR): Promise<RouteDef[]> {
  const core = new RouteRegistrar('core');
  registerCoreRoutes(core, deps);
  const all = [...core.routes];
  if (existsSync(featuresDir)) {
    for (const area of readdirSync(featuresDir).sort()) {
      const file = join(featuresDir, area, 'routes.ts');
      if (!existsSync(file)) continue;
      const mod = (await import(file)) as { default?: RoutesModule };
      if (typeof mod.default !== 'function') throw new Error(`src/features/${area}/routes.ts must default-export defineRoutes(...)`);
      const r = new RouteRegistrar(area);
      await mod.default(r, deps);
      all.push(...r.routes);
    }
  }
  const seen = new Map<string, string>();
  for (const r of all) {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) throw new Error(`Route ${k} registered twice (${seen.get(k)} and ${r.feature})`);
    seen.set(k, r.feature);
  }
  return all;
}

function decodePath(raw: string): string | null {
  try {
    return raw.split('/').map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

/** A domain error from outside src/http/errors.ts that still carries an HTTP status and an `error` code. */
function isCodedLike(err: unknown): err is Error & { status: number; code: string; headers?: () => Record<string, string> } {
  const e = err as { status?: unknown; code?: unknown } | null;
  return err instanceof Error && typeof e?.status === 'number' && e.status >= 400 && e.status < 600 && typeof e?.code === 'string';
}

function errorResponse(deps: Deps, err: unknown, state: RequestState | undefined): Response {
  // ErrorResponse.of: Instant.now() (system time).
  const now = systemNowMicros();
  const path = state?.requestUri ?? '';
  let e: ApiError;
  if (err instanceof ApiError) e = err;
  else if (isCodedLike(err)) e = new CodedError(err.status, err.code, err.message, typeof err.headers === 'function' ? err.headers() : {});
  else if (isDataIntegrityViolation(err)) {
    deps.log.warn(`Data integrity violation at ${path}: ${(err as Error).message}`);
    e = new DataIntegrityViolationError(err);
  } else {
    deps.log.error({ err }, `Unhandled exception at ${path}`);
    e = new InternalServerError();
  }
  if (e instanceof ExternalApiError) deps.log.error({ err: e.cause }, `External API error at ${path}`);
  return new Response(toJavaJson(e.body(path, now)), {
    status: e.status,
    headers: { 'Content-Type': 'application/json', ...e.headers() },
  });
}

export async function createApp(deps: Deps, opts: { featuresDir?: string } = {}): Promise<App> {
  const routes = await collectRoutes(deps, opts.featuresDir);
  setRoutesProvider(() => routes);
  const limiter = new IpRateLimiter(deps.config.rateLimit);
  const hono = new Hono<AppEnv>({ strict: true });
  const compiled = routes.map((r) => ({ route: r, re: springPathRegExp(r.path) }));

  hono.onError((err, c) => errorResponse(deps, err, c.get('state')));

  hono.use('*', async (c, next) => {
    const state = c.env.state;
    c.set('state', state);
    c.set('deps', deps);
    const denied = await authenticateAndAuthorize(deps, c.req.raw, state, limiter);
    if (denied) {
      c.res = denied;
      return;
    }
    await next();
  });

  // Spring picks the most specific pattern; Hono the first registered: register in specificity order.
  const ordered = [...routes].sort((a, b) => compareSpecificity(a.path, b.path));
  for (const r of ordered) {
    const h = wrapHandler(r, deps);
    hono.on(r.method, toHonoPath(r.path), (c) => h(c as AppContext));
  }

  hono.notFound((c) => {
    const state = c.get('state');
    const matching = compiled.filter((x) => x.re.test(state.path));
    if (matching.length === 0) throw new NoResourceFoundError(state.path);
    const methods = [...new Set(matching.map((x) => x.route.method))];
    if (state.method === 'OPTIONS') {
      const allow = methods.flatMap((m) => (m === 'GET' ? ['GET', 'HEAD'] : [m]));
      return new Response(null, { status: 200, headers: { Allow: [...allow, 'OPTIONS'].join(',') } });
    }
    throw new MethodNotAllowedError(state.method, methods);
  });

  async function handle(req: Request, remoteAddr: string): Promise<Response> {
    const url = new URL(req.url);
    const requestUri = url.pathname;
    // Tomcat: the context root without a slash redirects; other paths are not ours.
    if (requestUri === '/api') {
      return new Response(null, { status: 302, headers: { Location: `${url.protocol}//${url.host}/api/${url.search}` } });
    }
    if (!requestUri.startsWith('/api/')) return new Response(null, { status: 404 });
    // Tomcat rejects encoded slashes/backslashes (400); StrictHttpFirewall rejects
    // `//`, `;` and backslashes, which surfaces as a 401 from the /error dispatch.
    if (/%2f|%5c/i.test(requestUri)) return new Response(null, { status: 400 });
    const rawPath = requestUri.slice(4);
    const path = decodePath(rawPath);
    if (path === null) return new Response(null, { status: 400 });
    if (/\/\/|;|\\/.test(rawPath) || /\/\/|;|\\/.test(path)) {
      return new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }

    const cors = processCors(req, url);
    if (cors.kind === 'respond') return applySecurityHeaders(cors.response);

    const state: RequestState = {
      requestUri,
      rawPath,
      path,
      method: req.method.toUpperCase(),
      remoteAddr,
      clientIp: resolveClientIp(remoteAddr, req.headers.get('X-Forwarded-For'), deps.config.rateLimit.trustForwardedFor),
      principal: { kind: 'anonymous' },
      extraHeaders: {},
    };
    let res: Response;
    try {
      res = await hono.fetch(req, { state });
    } catch (e) {
      res = errorResponse(deps, e, state);
    }
    const extra = state.extraHeaders;
    // Responses from fetch() have immutable headers when they come from elsewhere: copy.
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    for (const [k, v] of Object.entries(cors.headers)) out.headers.set(k, v);
    for (const [k, v] of Object.entries(extra)) if (!out.headers.has(k)) out.headers.set(k, v);
    withVary(out);
    return applySecurityHeaders(out);
  }

  return {
    routes,
    fetch: (req, server) => handle(req, server?.requestIP(req)?.address ?? '127.0.0.1'),
    request: (pathOrReq, init, remoteAddr = '127.0.0.1') => {
      const req = typeof pathOrReq === 'string'
        ? new Request(new URL(pathOrReq, 'http://localhost'), init)
        : pathOrReq;
      return handle(req, remoteAddr);
    },
  };
}

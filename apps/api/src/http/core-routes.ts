// Routes that are not a feature: HealthController (`/`, `/health`), Spring
// Boot Actuator (`/actuator/health`, its liveness/readiness groups,
// `/actuator/info`) and springdoc (`/docs.json`, `/docs`, `/swagger-ui/**`).
//
// Readiness follows config/ShutdownDrain: once shutdown starts it answers 503
// OUT_OF_SERVICE (Caddy moves traffic away) while requests keep being served
// for SHUTDOWN_DRAIN.

import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { javaDouble } from '../lib/json';
import { formatInstant, systemNowMicros } from '../lib/time';
import type { AppContext } from './context';
import { buildOpenApi } from './openapi';
import { found, json, type RouteRegistrar } from './router';

const ACTUATOR_V3 = 'application/vnd.spring-boot.actuator.v3+json';
const startedAt = performance.now();

/** Actuator content negotiation: application/json when asked for it explicitly, else the v3 type. */
function actuatorJson(c: AppContext, body: unknown, status = 200): Response {
  const accept = (c.req.header('accept') ?? '').toLowerCase();
  const plain = accept.includes('application/json') && !accept.includes('actuator');
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': plain ? 'application/json' : ACTUATOR_V3 } });
}

async function dbUp(deps: Deps): Promise<boolean> {
  try {
    await deps.db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export function registerCoreRoutes(r: RouteRegistrar, deps: Deps): void {
  // HealthController: Map.of(...) has no stable key order in Java; we use declaration order.
  r.get('/', { tags: ['Health'], summary: 'Get API status' }, () => ({
    message: 'CEITBA API is running',
    version: '1.0.0',
    environment: deps.config.server.environment,
    timestamp: formatInstant(systemNowMicros()),
  }));

  r.get('/health', { tags: ['Health'], summary: 'Get health status' }, () => {
    const m = process.memoryUsage();
    return {
      status: 'healthy',
      timestamp: formatInstant(systemNowMicros()),
      // ManagementFactory uptime in seconds, a Java double (e.g. 90.585).
      uptime: javaDouble(Math.round(performance.now() - startedAt) / 1000),
      // Runtime.totalMemory/freeMemory/maxMemory: the JS heap is the closest analogue.
      memory: { total: Math.max(m.heapTotal, m.heapUsed), free: Math.max(0, m.heapTotal - m.heapUsed), used: m.heapUsed, max: Math.max(m.rss, m.heapTotal) },
      version: '1.0.0',
    };
  });

  // Aggregate: db + diskSpace + ping + livenessState + readinessState.
  r.get('/actuator/health', { hidden: true }, async ({ c }) => {
    const ready = deps.availability.acceptingTraffic;
    const db = await dbUp(deps);
    const status = !db || !deps.availability.live ? 'DOWN' : !ready ? 'OUT_OF_SERVICE' : 'UP';
    return actuatorJson(c, { status, groups: ['liveness', 'readiness'] }, status === 'UP' ? 200 : 503);
  });
  r.get('/actuator/health/liveness', { hidden: true }, ({ c }) =>
    actuatorJson(c, { status: deps.availability.live ? 'UP' : 'DOWN' }, deps.availability.live ? 200 : 503));
  r.get('/actuator/health/readiness', { hidden: true }, ({ c }) => {
    const ok = deps.availability.acceptingTraffic;
    return actuatorJson(c, { status: ok ? 'UP' : 'OUT_OF_SERVICE' }, ok ? 200 : 503);
  });
  r.get('/actuator/info', { hidden: true }, ({ c }) => actuatorJson(c, {}));

  r.get('/docs.json', { hidden: true }, ({ c }) => json(buildOpenApi(c, getRoutes())));
  r.get('/docs', { hidden: true }, ({ c }) => found(`${new URL(c.req.url).origin}/api/swagger-ui/index.html`));
  r.get('/swagger-ui/index.html', { hidden: true }, () => new Response(SWAGGER_HTML, { headers: { 'Content-Type': 'text/html' } }));
}

let routesRef: () => import('./router').RouteDef[] = () => [];
export function setRoutesProvider(fn: () => import('./router').RouteDef[]) {
  routesRef = fn;
}
const getRoutes = () => routesRef();

const SWAGGER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CEITBA API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: '/api/docs.json', dom_id: '#swagger-ui' });</script>
</body></html>`;

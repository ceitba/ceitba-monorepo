// /api/docs.json: an OpenAPI 3.0 document assembled from the registered
// routes (summary, tags, path/query parameters, request body presence), with
// the same info and security schemes as config/OpenApiConfig. Features add
// documentation through their RouteSpec (summary, tags, hidden).

import type { AppContext } from './context';
import type { RouteDef } from './router';

export function buildOpenApi(c: AppContext, routes: RouteDef[]) {
  const origin = new URL(c.req.url).origin;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    if (r.spec.hidden || r.feature === 'core' && r.path.startsWith('/actuator')) continue;
    const p = r.path.replace(/\{(\w+):[^}]*\}+/g, '{$1}');
    const vars = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    const parameters = [
      ...vars.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...Object.keys(r.spec.query ?? {}).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
    ];
    const op: Record<string, unknown> = {
      tags: r.spec.tags ?? [r.feature],
      summary: r.spec.summary,
      operationId: `${r.method.toLowerCase()}${p.replace(/[^A-Za-z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ? ch.toUpperCase() : ''))}`,
      ...(parameters.length ? { parameters } : {}),
      ...(r.spec.body ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } }, required: !r.spec.bodyOptional } } : {}),
      responses: { [String(r.spec.status ?? 200)]: { description: 'OK' } },
    };
    (paths[p] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.1',
    info: { title: 'CEITBA API', description: 'CEITBA API for managing ITBA academic data and users', version: '1.0.0' },
    servers: [{ url: `${origin}/api`, description: 'Generated server url' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
          description: 'CEITBA-issued HS256 JWT (never a Google token). Web SPAs receive it as the HttpOnly session cookie after GET /v1/auth/google; the mobile app gets it from POST /v1/auth/google/mobile (Google ID token exchange) and renews it with POST /v1/auth/refresh. Send it as Authorization: Bearer <jwt>.',
        },
        apiKey: {
          type: 'apiKey', in: 'header', name: 'X-API-Key',
          description: 'Either the static AUTH_SYNC_API_KEY for /v1/sync/** (cron / ops), or a per-user ceitba_* key created via POST /v1/auth/api-keys.',
        },
      },
    },
  };
}

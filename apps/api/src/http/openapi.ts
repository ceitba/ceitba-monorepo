// /api/docs.json: the OpenAPI document springdoc generated for the Spring app (src/http/openapi.json, exported
// from the last Java build's /api/docs.json), served as is: the same paths, operationIds, parameters, request and
// response component schemas, security schemes. Only `servers` follows the request's origin, like springdoc's
// "Generated server url". The document is maintained by hand from now on: a route added, removed or changed
// edits src/http/openapi.json in the same PR (test/http/openapi.test.ts fails when a registered, non-hidden route
// has no operation in it or an operation has no route; AGENTS.md / the api-endpoint skill say how).

import type { AppContext } from './context';
import base from './openapi.json' with { type: 'json' };

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: { url: string; description: string }[];
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: Record<string, unknown>;
}

/** The served document (a fresh copy). */
export function openApiDocument(origin: string): OpenApiDocument {
  const doc = structuredClone(base) as unknown as OpenApiDocument;
  doc.servers = [{ url: `${origin}/api`, description: 'Generated server url' }];
  return doc;
}

export function buildOpenApi(c: AppContext): OpenApiDocument {
  return openApiDocument(new URL(c.req.url).origin);
}

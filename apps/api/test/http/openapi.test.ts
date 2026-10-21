// /api/docs.json serves src/http/openapi.json (springdoc's document of the Spring app). It is maintained by hand:
// this test fails when a registered, non-hidden route has no operation in it, or an operation has no route, so a
// new endpoint cannot ship without its entry (AGENTS.md "OpenAPI document").
import { describe, expect, test } from 'bun:test';
import { tsRoutes } from '../../contract/support/routes';
import { ruleKey } from '../../src/http/auth/policy';
import { openApiDocument } from '../../src/http/openapi';

const doc = openApiDocument('http://localhost:8080');
const documented = new Set(Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));

describe('OpenAPI document', () => {
  test('everyRegisteredRouteIsDocumentedAndViceVersa', async () => {
    const routes = (await tsRoutes()).filter((r) => !r.spec.hidden);
    const registered = new Set(routes.map((r) => ruleKey(r.method, r.path)));
    expect([...registered].filter((k) => !documented.has(k)).sort()).toEqual([]);
    expect([...documented].filter((k) => !registered.has(k)).sort()).toEqual([]);
  });

  test('keepsSpringdocsSchemasAndOperationIds', () => {
    expect(doc.openapi).toBe('3.0.1');
    expect(Object.keys(doc.components.schemas as object).length).toBeGreaterThan(200);
    expect(doc.paths['/v1/careers']!.post!.operationId).toBe('createCareer');
    expect(doc.servers).toEqual([{ url: 'http://localhost:8080/api', description: 'Generated server url' }]);
  });

  test('everySchemaReferenceResolves', () => {
    const schemas = doc.components.schemas as Record<string, unknown>;
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.filter((r) => !(r in schemas))).toEqual([]);
  });
});

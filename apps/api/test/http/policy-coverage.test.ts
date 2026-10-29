// Security guard for src/http/auth/policy.ts. A mismatch there fails OPEN (a
// route whose key is not in METHOD_RULES runs without its @PreAuthorize), so
// this test checks, against the frozen snapshot of the Spring app's security
// policy (test/fixtures/java-security-policy.json), in both directions:
//   1. every METHOD_RULES key is a registered TS route;
//   2. every Java controller method with @PreAuthorize has a METHOD_RULES entry,
//      with the same roles / checks / operators;
//   3. every registered TS route without a rule had no @PreAuthorize in Java;
//   4. URL_RULES is SecurityConfig.authorizeHttpRequests, rule for rule, in order.
// The Spring app was the specification; it is deleted, so the snapshot it produced
// (by a Java source scanner, last run at commit b515215) is the spec now. A deliberate
// rule change edits policy.ts and the snapshot together.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_RULES, ruleKey, URL_RULES, type MethodExpr, type UrlRule } from '../../src/http/auth/policy';
import { tsRoutes } from '../../contract/support/routes';

const SNAPSHOT = join(import.meta.dir, '..', 'fixtures', 'java-security-policy.json');

function renderRule(e: MethodExpr): string {
  if ('role' in e) return `hasRole(${e.role})`;
  if ('jwtSession' in e) return 'JWT';
  if ('check' in e) return `@${e.check}(${e.args.map((a) => a.replace(/^(path|body)\./, '')).join(',')})`;
  if ('or' in e) return e.or.map(renderRule).join(' or ');
  return e.and.map(renderRule).join(' and ');
}

const normUrlRule = (r: UrlRule) => JSON.stringify({ method: r.method ?? null, patterns: r.patterns, access: r.access, enabledWhen: r.enabledWhen ?? null });

interface Snapshot {
  /** Every Java endpoint "METHOD /path" -> its normalized @PreAuthorize (null: none). */
  endpoints: Record<string, string | null>;
  urlRules: string[];
}

const snapshot: Snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

// ------------------------------------------------------------- tests

describe('policy.ts coverage', () => {
  test('every METHOD_RULES key matches a registered route', async () => {
    const keys = new Set((await tsRoutes()).map((r) => ruleKey(r.method, r.path)));
    const orphans = Object.keys(METHOD_RULES).filter((k) => !keys.has(k));
    expect(orphans).toEqual([]);
  });

  test('every Java @PreAuthorize endpoint has the same METHOD_RULES rule', () => {
    const keys = Object.keys(snapshot.endpoints);
    expect(keys.length).toBeGreaterThan(250);
    const protectedOnes = keys.filter((k) => snapshot.endpoints[k] !== null);
    expect(protectedOnes.length).toBeGreaterThan(150);
    expect(protectedOnes.filter((k) => !METHOD_RULES[k])).toEqual([]);
    const different = protectedOnes
      .filter((k) => METHOD_RULES[k] && snapshot.endpoints[k] !== renderRule(METHOD_RULES[k]!))
      .map((k) => `${k}: java "${snapshot.endpoints[k]}" vs ts "${renderRule(METHOD_RULES[k]!)}"`);
    expect(different).toEqual([]);
    expect(Object.keys(METHOD_RULES).filter((k) => !protectedOnes.includes(k))).toEqual([]);
  });

  test('every registered route maps to a Java endpoint, and routes without a rule have none in Java', async () => {
    const routes = await tsRoutes();
    const unknown = routes.filter((r) => r.feature !== 'core' && !(ruleKey(r.method, r.path) in snapshot.endpoints)).map((r) => `${r.feature}: ${ruleKey(r.method, r.path)}`);
    expect(unknown).toEqual([]);
    const unguarded = routes
      .filter((r) => !METHOD_RULES[ruleKey(r.method, r.path)] && snapshot.endpoints[ruleKey(r.method, r.path)])
      .map((r) => ruleKey(r.method, r.path));
    expect(unguarded).toEqual([]);
  });

  test('URL_RULES is SecurityConfig.authorizeHttpRequests in the same order', () => {
    expect(URL_RULES.map(normUrlRule)).toEqual(snapshot.urlRules);
  });
});

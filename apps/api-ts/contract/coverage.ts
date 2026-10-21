// Route coverage report: every operation of the Java API (contract/openapi.json,
// exported from the running jar's /api/docs.json, 295 operations) with
//   - TS: whether apps/api-ts has a handler for it (the registered routes);
//   - tested: whether >= 1 contract test request hit it (contract/.hits/<run id>/, all runs merged; written
//     by the harness during `bun contract/run.ts`).
//
//   bun contract/coverage.ts            # summary + per-area table
//   bun contract/coverage.ts --list     # every operation
//   bun contract/coverage.ts --json     # machine-readable
//   bun contract/coverage.ts --check    # exit 1 if an operation has neither a TS handler nor a test

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ruleKey } from '../src/http/auth/policy';
import { springPathRegExp } from '../src/http/router';
import { tsRoutes } from './support/routes';

const spec = JSON.parse(readFileSync(join(import.meta.dir, 'openapi.json'), 'utf8')) as { paths: Record<string, Record<string, { tags?: string[] }>> };
const ops: { method: string; path: string; tag: string; re: RegExp }[] = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [m, op] of Object.entries(methods)) {
    ops.push({ method: m.toUpperCase(), path, tag: op.tags?.[0] ?? 'other', re: springPathRegExp(path) });
  }
}

const routes = await tsRoutes();
const tsKeys = new Set(routes.map((r) => ruleKey(r.method, r.path)));

const hitsDir = join(import.meta.dir, '.hits');
const hits: { method: string; path: string; target: string }[] = [];
// .hits/<run id>/<target>-<file>-<pid>.jsonl: every run's hits, merged.
const hitFiles = existsSync(hitsDir)
  ? (readdirSync(hitsDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.jsonl')).map((f) => join(hitsDir, f))
  : [];
{
  for (const file of hitFiles) {
    const target = basename(file).split('-')[0]!;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const h = JSON.parse(line) as { method: string; path: string };
      let decoded = h.path;
      try { decoded = decodeURIComponent(h.path); } catch { /* keep raw */ }
      hits.push({ method: h.method, path: decoded, target });
    }
  }
}

// A concrete path matches the most specific template (literal segments beat variables).
const specificity = (p: string) => (p.match(/\{/g) ?? []).length;
const tested = new Map<string, Set<string>>();
for (const h of hits) {
  const candidates = ops.filter((o) => o.method === h.method && o.re.test(h.path)).sort((a, b) => specificity(a.path) - specificity(b.path));
  const best = candidates[0];
  if (best) {
    const k = `${best.method} ${best.path}`;
    tested.set(k, (tested.get(k) ?? new Set()).add(h.target));
  }
}

const rows = ops.map((o) => {
  const k = `${o.method} ${o.path}`;
  return { op: k, tag: o.tag, ts: tsKeys.has(k), tested: [...(tested.get(k) ?? [])].sort() };
}).sort((a, b) => a.tag.localeCompare(b.tag) || a.op.localeCompare(b.op));

const args = process.argv.slice(2);
if (args.includes('--json')) {
  console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
} else {
  const byTag = new Map<string, typeof rows>();
  for (const r of rows) byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), r]);
  console.log(`${'area'.padEnd(28)} ${'ops'.padStart(4)} ${'TS'.padStart(4)} ${'tested'.padStart(7)}`);
  for (const [tag, rs] of [...byTag].sort()) {
    console.log(`${tag.padEnd(28)} ${String(rs.length).padStart(4)} ${String(rs.filter((r) => r.ts).length).padStart(4)} ${String(rs.filter((r) => r.tested.length).length).padStart(7)}`);
  }
  const tsCount = rows.filter((r) => r.ts).length;
  const testedCount = rows.filter((r) => r.tested.length).length;
  console.log(`\nTotal: ${rows.length} operations, ${tsCount} with a TS handler, ${testedCount} hit by >= 1 contract test (hits from: ${[...new Set(hits.map((h) => h.target))].join(', ') || 'none; run bun contract/run.ts first'})`);
  if (args.includes('--list')) {
    for (const r of rows) console.log(`${r.ts ? 'TS ' : '   '} ${r.tested.length ? `T[${r.tested.join(',')}]` : '      '.padEnd(9)} ${r.op}`);
  }
}
if (args.includes('--check')) {
  const missing = rows.filter((r) => !r.ts && r.tested.length === 0);
  if (missing.length) {
    console.error(`${missing.length} operations have neither a TS handler nor a contract test`);
    process.exit(1);
  }
}

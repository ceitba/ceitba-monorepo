#!/usr/bin/env node
// Flyway rules for apps/api (.agents/skills/flyway-migration/SKILL.md):
//  1. migrations already on the base branch are never modified, renamed or deleted;
//  2. versions are unique and file names are V<version>__<snake_case>.sql;
//  3. every DDL prod migration after V4.x has a test mirror listed in the mirror README;
//  4. the integration-test Flyway target (IT_FLYWAY_TARGET in the API's
//     contract/support/pg.ts, used by the contract suite and the in-process tests)
//     is the highest mirror version.
//
// The SQL stays where Flyway's classpath put it (src/main/resources/db/migration,
// src/test/resources/db/test-migration) even though the API is no longer Java:
// rule 1 forbids renaming merged migrations, and the runner (src/db/migrate.ts)
// only records file names, so the directory is free to stay.
//
//   node scripts/checks/migrations.mjs [--base <ref>]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, baseRef, fileStatuses, report } from './lib.mjs';

const API = 'apps/api/src';
const PROD = `${API}/main/resources/db/migration`;
const MIRROR = `${API}/test/resources/db/test-migration`;
const TARGET_FILE = 'apps/api/contract/support/pg.ts';
const NAME = /^V(\d+(?:\.\d+)*)__[a-z0-9_]+\.sql$/;
const DDL = /^\s*(create|alter|drop|rename|comment\s+on)\b/im;

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

const errors = [];
const base = baseRef();

// 1. immutability
if (base) {
  for (const [path, status] of fileStatuses(base)) {
    if ((path.startsWith(`${PROD}/`) || path.startsWith(`${MIRROR}/V`)) && path.endsWith('.sql') && status !== 'A') {
      errors.push(`${path}: merged migrations are immutable (status ${status} vs ${base}); add a new migration instead`);
    }
  }
}

// 2. names and unique versions
const versions = (dir) => {
  const seen = new Map();
  for (const f of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.sql'))) {
    const m = f.match(NAME);
    if (!m) { errors.push(`${dir}/${f}: name must be V<version>__<snake_case>.sql`); continue; }
    if (seen.has(m[1])) errors.push(`${dir}: version ${m[1]} used by ${seen.get(m[1])} and ${f}`);
    seen.set(m[1], f);
  }
  return seen;
};
const prod = versions(PROD);
const mirrors = versions(MIRROR);

// 3. mirrors: README rows look like "| V4.22 schedule_corrections | V30 |" (or "V8/V9")
const readme = readFileSync(join(ROOT, MIRROR, 'README.md'), 'utf8');
const mirrored = new Set();
for (const row of readme.matchAll(/^\|\s*V(4\.\d+)\b[^|]*\|\s*([^|]+)\|/gm)) {
  if (!mirrors.has(row[1])) errors.push(`${MIRROR}/README.md: lists V${row[1]} but no such mirror file exists`);
  for (const v of row[2].matchAll(/V(\d+(?:\.\d+)?)/g)) mirrored.add(v[1]);
}
for (const [version, file] of prod) {
  if (cmp(version, '5') < 0) continue; // V1..V4.x run in tests as-is
  const sql = readFileSync(join(ROOT, PROD, file), 'utf8').replace(/--.*$/gm, '');
  if (DDL.test(sql) && !mirrored.has(version)) {
    errors.push(`${PROD}/${file}: DDL migration without a test mirror; add ${MIRROR}/V4.<n>__*.sql and a README row (flyway-migration skill)`);
  }
}

// 4. test target
const target = readFileSync(join(ROOT, TARGET_FILE), 'utf8').match(/^export const IT_FLYWAY_TARGET = '([\d.]+)'/m)?.[1];
const highest = [...mirrors.keys()].sort(cmp).at(-1);
if (target !== highest) errors.push(`${TARGET_FILE}: IT_FLYWAY_TARGET is '${target}' but the highest mirror is V${highest}`);

process.exit(report('migrations', errors) ? 0 : 1);

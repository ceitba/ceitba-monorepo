#!/usr/bin/env node
// Runs every repo check. Same scripts run in git hooks (lefthook.yml), agent stop
// hooks and CI (.github/workflows/ci.yml), so a green local run means a green gate.
//
//   node scripts/checks/run-all.mjs [--base <ref>]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const CHECKS = ['locales', 'migrations', 'workflows', 'agents'];
const extra = process.argv.slice(2);
let failed = 0;
for (const c of CHECKS) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'checks', `${c}.mjs`), ...extra], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
// The checks' own unit tests (scripts/checks/*.test.mjs).
const tests = readdirSync(join(ROOT, 'scripts', 'checks')).filter((f) => f.endsWith('.test.mjs')).map((f) => join(ROOT, 'scripts', 'checks', f));
if (tests.length > 0) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...tests], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
  else console.log('ok    [checks-tests]');
}
// Living docs: advisory locally; CI enforces it with the PR body.
spawnSync(process.execPath, [join(ROOT, 'scripts', 'checks', 'spec-sync.mjs'), '--warn', ...extra], { stdio: 'inherit' });
process.exit(failed ? 1 : 0);

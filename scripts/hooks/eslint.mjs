#!/usr/bin/env node
// Runs apps/web's own ESLint on the given files (paths relative to apps/web) with the
// same flags as its `lint` script, so the git and agent hooks catch what CI catches.
// Resolves the binary through Node instead of `bunx`, which needs a global bun.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web');
let bin;
try {
  const pkg = createRequire(join(WEB, 'package.json')).resolve('eslint/package.json');
  bin = join(dirname(pkg), 'bin', 'eslint.js');
} catch {
  console.error('ESLint is not installed: run `bun install` at the repo root.');
  process.exit(1);
}
const files = process.argv.slice(2);
if (!files.length) process.exit(0);
const r = spawnSync(process.execPath,
  [bin, '--report-unused-disable-directives', '--max-warnings', '0', '--no-warn-ignored', ...files],
  { cwd: WEB, stdio: 'inherit' });
process.exit(r.status ?? 1);

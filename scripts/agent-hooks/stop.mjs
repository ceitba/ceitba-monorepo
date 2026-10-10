#!/usr/bin/env node
// Stop hook shared by Claude Code, Codex and Kiro. When the agent tries to finish
// with uncommitted changes, runs the repo checks and ESLint on the touched web
// files; on failure it prints {"decision":"block","reason":...} so the agent keeps
// going and fixes them. Runs at most once per stop (stop_hook_active), so it can
// never loop.
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let event = {};
try { event = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no input */ }
if (event.stop_hook_active || event.stopHookActive) process.exit(0);

const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }); } catch { return ''; } };
// --diff-filter=d: deleted files have nothing to lint.
const changed = [...new Set([
  ...git('diff', '--name-only', '--diff-filter=d', 'HEAD').split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean))];
if (!changed.length) process.exit(0);

const failures = [];
const run = (label, cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 150_000 });
  if (r.status === 0) return;
  // A missing binary or a timeout leaves status null and no output; report it instead of crashing.
  const output = r.error ? String(r.error.message) : `${r.stdout ?? ''}${r.stderr ?? ''}`;
  failures.push(`${label}:\n${output.trim().split('\n').slice(-25).join('\n')}`);
};

run('repo checks (node scripts/checks/run-all.mjs)', process.execPath, [join(ROOT, 'scripts', 'checks', 'run-all.mjs')]);
for (const app of ['web']) {
  const files = changed.filter((f) => f.startsWith(`apps/${app}/`) && /\.(tsx?|jsx?)$/.test(f))
    .map((f) => f.slice(`apps/${app}/`.length));
  if (files.length) run(`eslint (apps/${app})`, process.execPath, [join(ROOT, 'scripts', 'hooks', 'eslint.mjs'), ...files]);
}

if (failures.length) {
  const reason = `Checks failed on your uncommitted changes. Fix them before finishing:\n\n${failures.join('\n\n')}`;
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}
process.exit(0);

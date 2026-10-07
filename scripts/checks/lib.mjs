// Shared helpers for scripts/checks/*. Plain Node 18+, no dependencies.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

export function refExists(ref) {
  try { git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`); return true; } catch { return false; }
}

// The ref a branch is compared against: --base <ref>, $CHECK_BASE, origin/dev, dev; null if none exists.
export function baseRef(argv = process.argv) {
  const i = argv.indexOf('--base');
  const candidates = [i >= 0 ? argv[i + 1] : null, process.env.CHECK_BASE, 'origin/dev', 'dev'].filter(Boolean);
  return candidates.find(refExists) ?? null;
}

// Files changed on this branch vs base (merge-base diff) plus staged, unstaged and untracked files.
export function changedFiles(base) {
  const out = new Set();
  const add = (s) => s.split('\n').filter(Boolean).forEach((f) => out.add(f));
  if (base) add(git('diff', '--name-only', `${base}...HEAD`));
  add(git('diff', '--name-only', 'HEAD'));
  add(git('ls-files', '--others', '--exclude-standard'));
  return [...out];
}

// Status per file vs base: A(dded), M(odified), D(eleted), R(enamed: old path reported as D).
export function fileStatuses(base) {
  const st = new Map();
  const parse = (s) => s.split('\n').filter(Boolean).forEach((line) => {
    const [code, ...paths] = line.split('\t');
    if (code.startsWith('R')) { st.set(paths[0], 'D'); st.set(paths[1], 'A'); }
    else st.set(paths[0], st.get(paths[0]) === 'A' ? 'A' : code[0]);
  });
  if (base) parse(git('diff', '--name-status', `${base}...HEAD`));
  parse(git('diff', '--name-status', 'HEAD'));
  git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean).forEach((f) => st.set(f, 'A'));
  return st;
}

// Minimal glob: ** = any depth, * = one path segment part, ? = one char.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function report(name, errors, warnings = []) {
  for (const w of warnings) console.warn(`warn  [${name}] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error [${name}] ${e}`);
    return false;
  }
  console.log(`ok    [${name}]`);
  return true;
}

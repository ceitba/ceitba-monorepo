#!/usr/bin/env node
// PreToolUse guard shared by Claude Code (.claude/settings.json), Codex
// (.codex/hooks.json) and Kiro (.kiro/hooks/guard.json). Reads the hook event JSON on
// stdin; exit 2 + stderr blocks the tool call in all three tools.
//
// Blocks:
//  - git push to main/dev, force pushes, and --no-verify (hooks are the guardrails);
//  - edits to Flyway migrations that already exist on the base branch;
//  - edits to real env files (.env, .env.local, ...; .env.example is fine);
//  - hand edits to bun.lock and to generated subagent files.
// Unknown tools and malformed input pass: this is a guardrail, not a sandbox.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let event;
try { event = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const input = event.tool_input ?? event.toolInput ?? event.input ?? {};
const tool = String(event.tool_name ?? event.toolName ?? '');

const block = (reason) => {
  process.stderr.write(`Blocked by repo guard (scripts/agent-hooks/guard.mjs): ${reason}\n`);
  process.exit(2);
};

// ---- shell commands -------------------------------------------------------
const PATCH = /^\*\*\* (?:Begin Patch|Add File|Update File|Delete File)/m;
const command = typeof input.command === 'string' ? input.command : '';
const isPatch = /apply_patch/i.test(tool) || PATCH.test(command);

if (command && !isPatch) {
  // Look at each simple command separately (a && b; c | d).
  for (const part of command.split(/&&|\|\||;|\||\n/).map((s) => s.trim())) {
    if (/^git\b/.test(part) || /\bgit\s+(push|commit)\b/.test(part)) {
      if (/\s--no-verify\b/.test(part) || /\bcommit\b.*\s-[a-zA-Z]*n[a-zA-Z]*\b/.test(part)) {
        block('do not skip git hooks (--no-verify). Fix what the hook reports instead.');
      }
      if (/\bpush\b/.test(part)) {
        if (/\s(--force|-f)\b/.test(part) && !/--force-with-lease/.test(part)) {
          block('force push is not allowed; use --force-with-lease on your own branch if you must.');
        }
        if (/(\s|:|\+)(main|dev)(\s|$)/.test(part) || /\bHEAD:(refs\/heads\/)?(main|dev)\b/.test(part)) {
          block('never push to main or dev. Push your feature branch and open a PR into dev.');
        }
        if (!/\s(origin|upstream)\s+\S/.test(part)) {
          const branch = (() => { try { return execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } })();
          if (branch === 'main' || branch === 'dev') block(`you are on ${branch}; create a feature branch from dev before pushing.`);
        }
      }
    }
  }
}

// ---- file edits -------------------------------------------------------------
const paths = new Set();
for (const key of ['file_path', 'path', 'filePath', 'targetFile', 'notebook_path']) {
  if (typeof input[key] === 'string') paths.add(input[key]);
}
if (Array.isArray(input.edits)) for (const e of input.edits) if (typeof e?.path === 'string') paths.add(e.path);
if (isPatch) {
  for (const m of command.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) paths.add(`${m[1]}:${m[2].trim()}`);
  for (const m of command.matchAll(/^\*\*\* Move to: (.+)$/gm)) paths.add(`Add:${m[1].trim()}`);
}

const onBase = (() => {
  const cache = new Map();
  const ref = ['origin/dev', 'dev'].find((r) => {
    try { execFileSync('git', ['rev-parse', '--verify', '--quiet', r], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
  });
  return (rel) => {
    if (!ref) return false;
    if (!cache.has(rel)) {
      try { execFileSync('git', ['cat-file', '-e', `${ref}:${rel}`], { cwd: ROOT, stdio: 'ignore' }); cache.set(rel, true); }
      catch { cache.set(rel, false); }
    }
    return cache.get(rel);
  };
})();

const cwd = event.cwd && isAbsolute(event.cwd) ? event.cwd : ROOT;
for (const raw of paths) {
  const [op, p] = raw.includes(':') && /^(Add|Update|Delete):/.test(raw) ? raw.split(/:(.*)/s) : ['Edit', raw];
  const abs = isAbsolute(p) ? p : join(cwd, p);
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (rel.startsWith('..')) continue;
  const name = rel.split('/').pop();

  if (/^\.env(\..+)?$/.test(name) && !/\.example$/.test(name)) {
    block(`${rel} holds local secrets; agents do not edit env files. Change ${rel.replace(/\.env.*$/, '.env.example')} and tell the user what to set.`);
  }
  if (rel === 'bun.lock') block('bun.lock is written by bun only; run `bun install` / `bun add <pkg>` instead.');
  if (/^\.(claude|kiro|codex)\/agents\//.test(rel)) {
    block(`${rel} is generated; edit .agents/agents/<name>.md and run node scripts/agents/sync.mjs.`);
  }
  const migration = /^apps\/api\/src\/(main\/resources\/db\/migration|test\/resources\/db\/test-migration)\/V[^/]+\.sql$/.test(rel);
  if (migration && op !== 'Add' && onBase(rel)) {
    block(`${rel} is already merged; migrations are immutable. Add a new migration (flyway-migration skill).`);
  }
}
process.exit(0);

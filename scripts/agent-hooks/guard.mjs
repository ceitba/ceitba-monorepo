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

// Splits a shell command into simple commands (arrays of words), honouring quotes and
// dropping heredoc bodies, so text inside a commit message never reads as a flag or a
// command of its own.
const simpleCommands = (cmd) => {
  const src = cmd.replace(/<<-?\s*(['"]?)([\w-]+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, ' $3');
  const out = [];
  let words = [];
  let word = null;
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = () => { endWord(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      word = (word ?? '') + src.slice(i + 1, j < 0 ? src.length : j);
      i = j < 0 ? src.length : j;
    } else if (c === '"') {
      let j = i + 1;
      let buf = '';
      for (; j < src.length && src[j] !== '"'; j++) buf += src[j] === '\\' && j + 1 < src.length ? src[++j] : src[j];
      word = (word ?? '') + buf;
      i = j;
    } else if (c === '\\' && i + 1 < src.length) {
      word = (word ?? '') + src[++i];
    } else if (/[;&|\n()]/.test(c)) {
      endCommand();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word = (word ?? '') + c;
    }
  }
  endCommand();
  return out;
};

const PROTECTED = new Set(['main', 'dev']);
const currentBranch = () => {
  try { return execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
};
// A refspec built from $VAR or $(...) can't be read here; assume it names the current branch.
const branchOf = (ref) => {
  const name = ref.replace(/^refs\/heads\//, '');
  return name === 'HEAD' || name === '@' || /[$`]/.test(name) ? currentBranch() : name;
};

// git global options that take a value as the next word.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const COMMIT_VALUE_OPTS = new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message',
  '-t', '--template', '--author', '--date', '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file']);
const COMMIT_SHORT_VALUE = new Set(['m', 'F', 'C', 'c', 't']);

const checkPush = (args) => {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { positional.push(...args.slice(i + 1)); break; }
    if (PUSH_VALUE_OPTS.has(a)) { i++; continue; }
    if (a === '--no-verify') block('do not skip git hooks (--no-verify). Fix what the hook reports instead.');
    if (a === '--force' || (/^-[a-zA-Z]+$/.test(a) && a.includes('f'))) {
      block('force push is not allowed; use --force-with-lease on your own branch if you must.');
    }
    if (a === '--all' || a === '--branches' || a === '--mirror') block(`git push ${a} would push main/dev too; push your feature branch only.`);
    if (!a.startsWith('-')) positional.push(a);
  }
  const refspecs = positional.slice(1);
  if (refspecs.some((r) => r.startsWith('+'))) {
    block('force push (+refspec) is not allowed; use --force-with-lease on your own branch if you must.');
  }
  const targets = refspecs.length
    ? refspecs.map((r) => { const spec = r.replace(/^\+/, ''); return branchOf(spec.includes(':') ? spec.split(':').pop() : spec); })
    : [currentBranch()];
  const hit = targets.find((b) => PROTECTED.has(b));
  if (hit) block(`never push to ${hit}. Push your feature branch and open a PR into dev.`);
};

const checkCommit = (args) => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a === '--no-verify') block('do not skip git hooks (--no-verify). Fix what the hook reports instead.');
    if (COMMIT_VALUE_OPTS.has(a)) { i++; continue; }
    if (/^-[a-zA-Z]+$/.test(a)) {
      for (const ch of a.slice(1)) {
        if (ch === 'n') block('do not skip git hooks (-n is --no-verify). Fix what the hook reports instead.');
        if (COMMIT_SHORT_VALUE.has(ch)) { if (a.endsWith(ch)) i++; break; }
      }
    }
  }
};

if (command && !isPatch) {
  for (const words of simpleCommands(command)) {
    const g = words.findIndex((w) => w === 'git' || w.endsWith('/git'));
    if (g < 0) continue;
    let i = g + 1;
    while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTS.has(words[i]) ? 2 : 1;
    const sub = words[i];
    const args = words.slice(i + 1);
    if (sub === 'push') checkPush(args);
    else if (sub === 'commit') checkCommit(args);
    else if (args.includes('--no-verify')) block('do not skip git hooks (--no-verify). Fix what the hook reports instead.');
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

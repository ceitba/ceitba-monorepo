#!/usr/bin/env node
// Conventional Commits check (docs/adr/0003-conventional-commits.md) for commit
// subjects and PR titles. Source of truth for allowed types.
//
//   node scripts/checks/commit-msg.mjs <commit-msg-file>   (git commit-msg hook)
//   node scripts/checks/commit-msg.mjs --title "<text>"    (PR title, CI)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert', 'style'];
const PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9./-]*\\))?(!)?: (\\S.*)$`);
const MAX = 100;

// Subjects git or GitHub write themselves; never rejected.
const EXEMPT = [/^Merge (branch|pull request|remote-tracking branch|tag) /, /^Revert ".*"$/, /^(fixup|squash|amend)! /];

export function checkSubject(subject) {
  if (EXEMPT.some((re) => re.test(subject))) return null;
  const m = subject.match(PATTERN);
  if (!m) {
    return `"${subject}" is not a Conventional Commit.\n` +
      `  Expected: type(scope): summary   e.g. "fix(scheduler): keep blocked times on reload"\n` +
      `  Types: ${TYPES.join(', ')}. Scope: api, web, scheduler, newsletter, infra, ci, deps, agents or a feature area.`;
  }
  if (subject.length > MAX) return `subject is ${subject.length} chars; keep it under ${MAX}.`;
  if (/\.$/.test(m[4])) return 'drop the trailing period from the summary.';
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let subject;
  if (args[0] === '--title') subject = args.slice(1).join(' ').trim();
  else if (args[0]) {
    subject = readFileSync(args[0], 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '';
  } else {
    console.error('usage: commit-msg.mjs <file> | --title "<text>"');
    process.exit(2);
  }
  const error = checkSubject(subject);
  if (error) { console.error(`commit-msg: ${error}`); process.exit(1); }
}

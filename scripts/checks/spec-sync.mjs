#!/usr/bin/env node
// Living-docs check (docs/agents/workflow.md): a change to a path mapped in
// docs/agents/spec-map.json must also change one of that area's docs, unless the PR
// declares "No spec impact" (a ticked checkbox) with a reason.
//
//   node scripts/checks/spec-sync.mjs [--base <ref>] [--body-file <file>] [--warn]
// --warn reports but exits 0 (local hooks); CI passes the PR body.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, baseRef, changedFiles, globToRegExp, report } from './lib.mjs';

const argv = process.argv;
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const map = JSON.parse(readFileSync(join(ROOT, 'docs', 'agents', 'spec-map.json'), 'utf8'));
const base = baseRef();
const changed = changedFiles(base);
const changedSet = new Set(changed);

const bodyFile = arg('--body-file');
// HTML comments (the template's hints, possibly multi-line) are not part of the answer.
const body = (bodyFile ? readFileSync(bodyFile, 'utf8') : '').replace(/<!--[\s\S]*?(-->|$)/g, '');
// The reason must sit on the checkbox's own line: [ \t] instead of \s so it can't run into the next line.
const optOut = body.match(/^[ \t]*[-*][ \t]*\[x\][ \t]*No spec impact\b[ \t:-]*([^\r\n]*)/im);
const optOutReason = optOut?.[1]?.trim();

const errors = [];
const warnings = [];
for (const area of map.areas) {
  const res = area.paths.map(globToRegExp);
  const hits = changed.filter((f) => res.some((re) => re.test(f)) && !area.docs.includes(f));
  if (!hits.length || area.docs.some((d) => changedSet.has(d))) continue;
  const msg = `${area.name}: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ` (+${hits.length - 3})` : ''} changed ` +
    `but none of ${area.docs.join(', ')} did. Update the doc (spec-sync skill) or tick "No spec impact" with a reason.`;
  (optOut ? warnings : errors).push(msg);
}
if (optOut && !optOutReason) errors.push('"No spec impact" is ticked without a reason');

const ok = report('spec-sync', argv.includes('--warn') ? [] : errors, argv.includes('--warn') ? [...errors, ...warnings] : warnings);
process.exit(ok ? 0 : 1);

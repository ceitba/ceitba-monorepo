#!/usr/bin/env node
// Agent setup integrity (docs/adr/0001):
//  - every CLAUDE.md imports its sibling AGENTS.md;
//  - every skill in .agents/skills is linked into .claude/skills and .kiro/skills (and nothing dangles);
//  - generated subagent files match .agents/agents (scripts/agents/sync.mjs --check).
import { readdirSync, readFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, git, report } from './lib.mjs';

const errors = [];

for (const claude of git('ls-files', '--cached', '--others', '--exclude-standard', '*CLAUDE.md').split('\n').filter(Boolean)) {
  const dir = claude.slice(0, -'CLAUDE.md'.length);
  if (!existsSync(join(ROOT, dir, 'AGENTS.md'))) errors.push(`${claude}: no sibling AGENTS.md`);
  else if (!/^@AGENTS\.md\s*$/m.test(readFileSync(join(ROOT, claude), 'utf8'))) errors.push(`${claude}: must contain the line "@AGENTS.md"`);
}

const skills = readdirSync(join(ROOT, '.agents', 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);
for (const s of skills) {
  if (!existsSync(join(ROOT, '.agents', 'skills', s, 'SKILL.md'))) errors.push(`.agents/skills/${s}: missing SKILL.md`);
}
for (const tool of ['.claude', '.kiro']) {
  const dir = join(ROOT, tool, 'skills');
  const links = existsSync(dir) ? readdirSync(dir) : [];
  for (const s of skills) {
    const p = join(dir, s);
    if (!links.includes(s)) errors.push(`${tool}/skills/${s}: missing (ln -s ../../.agents/skills/${s} ${tool}/skills/${s})`);
    else if (!lstatSync(p).isSymbolicLink() || readlinkSync(p) !== `../../.agents/skills/${s}`) {
      errors.push(`${tool}/skills/${s}: must be a symlink to ../../.agents/skills/${s}`);
    }
  }
  for (const l of links) if (!skills.includes(l)) errors.push(`${tool}/skills/${l}: no matching .agents/skills/${l}`);
}

try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'agents', 'sync.mjs'), '--check'], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  errors.push(String(e.stderr || e.message).trim());
}

process.exit(report('agents', errors) ? 0 : 1);

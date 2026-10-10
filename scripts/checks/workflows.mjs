#!/usr/bin/env node
// GitHub Actions hygiene:
//  - every third-party `uses:` is pinned to a full 40-char commit SHA with a `# vX` comment;
//  - setup-bun reads the bun version from package.json (packageManager), never a hardcoded
//    bun-version, so bun.lock, local bun and CI cannot drift apart.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report } from './lib.mjs';

const DIR = join(ROOT, '.github', 'workflows');
const errors = [];
const warnings = [];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (!/^bun@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? '')) {
  errors.push('package.json: packageManager must pin bun exactly, e.g. "bun@1.4.2"');
}

for (const f of existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)) : []) {
  readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
    const where = `.github/workflows/${f}:${i + 1}`;
    const use = line.match(/^\s*-?\s*uses:\s*([^\s#]+)\s*(#.*)?$/);
    if (use) {
      const [, ref, comment] = use;
      if (ref.startsWith('./') || ref.startsWith('docker://')) return;
      const at = ref.split('@')[1] ?? '';
      if (!/^[0-9a-f]{40}$/.test(at)) errors.push(`${where}: ${ref} must be pinned to a full commit SHA`);
      else if (!comment) warnings.push(`${where}: add a "# vX.Y.Z" comment after the SHA`);
    }
    if (/^\s*bun-version:/.test(line)) errors.push(`${where}: use "bun-version-file: package.json" instead of bun-version`);
  });
}
process.exit(report('workflows', errors, warnings) ? 0 : 1);

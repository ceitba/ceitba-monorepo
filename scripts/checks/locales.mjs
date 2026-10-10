#!/usr/bin/env node
// es/en locale parity for every locale folder of the web app (src/locales and each
// section's src/<section>/locales): both files of a pair have the same keys.
// i18next plural/ordinal suffixes (_one, _ordinal_few, ...) are folded into their
// base key, because languages legitimately need different plural forms.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, report } from './lib.mjs';

const PLURAL = /_(ordinal_)?(zero|one|two|few|many|other)$/;

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const errors = [];
// Every tracked or new apps/*/src/**/locales/ folder.
const dirs = new Set(git('ls-files', '--cached', '--others', '--exclude-standard', 'apps/*/src/**/locales/*.json', 'apps/*/src/locales/*.json')
  .split('\n').filter(Boolean).map((f) => f.slice(0, f.lastIndexOf('/'))));
for (const rel of [...dirs].sort()) {
  const dir = join(ROOT, rel);
  const pairs = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const m = f.match(/^(.*?)(es|en)\.json$/);
    if (!m) continue;
    let keys;
    try { keys = flatten(JSON.parse(readFileSync(join(dir, f), 'utf8'))); }
    catch (e) { errors.push(`${rel}/${f}: invalid JSON (${e.message})`); continue; }
    (pairs[m[1]] ??= {})[m[2]] = new Set(keys.map((k) => k.replace(PLURAL, '')));
  }
  for (const [prefix, { es, en }] of Object.entries(pairs)) {
    const name = `${rel}/${prefix}{es,en}.json`;
    if (!es || !en) { errors.push(`${name}: only one language exists`); continue; }
    const onlyEs = [...es].filter((k) => !en.has(k));
    const onlyEn = [...en].filter((k) => !es.has(k));
    if (onlyEs.length) errors.push(`${name}: missing in en: ${onlyEs.join(', ')}`);
    if (onlyEn.length) errors.push(`${name}: missing in es: ${onlyEn.join(', ')}`);
  }
}
process.exit(report('locales', errors) ? 0 : 1);

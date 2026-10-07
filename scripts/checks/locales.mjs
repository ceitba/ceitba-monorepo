#!/usr/bin/env node
// es/en locale parity for every web app: both files of a pair have the same keys.
// i18next plural/ordinal suffixes (_one, _ordinal_few, ...) are folded into their
// base key, because languages legitimately need different plural forms.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report } from './lib.mjs';

const APPS = ['web', 'scheduler', 'newsletter'];
const PLURAL = /_(ordinal_)?(zero|one|two|few|many|other)$/;

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const errors = [];
for (const app of APPS) {
  const dir = join(ROOT, 'apps', app, 'src', 'locales');
  if (!existsSync(dir)) continue;
  const pairs = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const m = f.match(/^(.*?)(es|en)\.json$/);
    if (!m) continue;
    let keys;
    try { keys = flatten(JSON.parse(readFileSync(join(dir, f), 'utf8'))); }
    catch (e) { errors.push(`apps/${app}/src/locales/${f}: invalid JSON (${e.message})`); continue; }
    (pairs[m[1]] ??= {})[m[2]] = new Set(keys.map((k) => k.replace(PLURAL, '')));
  }
  for (const [prefix, { es, en }] of Object.entries(pairs)) {
    const name = `apps/${app}/src/locales/${prefix}{es,en}.json`;
    if (!es || !en) { errors.push(`${name}: only one language exists`); continue; }
    const onlyEs = [...es].filter((k) => !en.has(k));
    const onlyEn = [...en].filter((k) => !es.has(k));
    if (onlyEs.length) errors.push(`${name}: missing in en: ${onlyEs.join(', ')}`);
    if (onlyEn.length) errors.push(`${name}: missing in es: ${onlyEn.join(', ')}`);
  }
}
process.exit(report('locales', errors) ? 0 : 1);

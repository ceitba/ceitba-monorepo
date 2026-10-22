#!/usr/bin/env node
// Did a change touch what the API image installs? Prints "true" or "false" (the reasons go to
// stderr). Used by the `changes` job of ci.yml and deploy.yml, next to the apps/api/** and
// infra/** path filter, so a web-only dependency bump (root bun.lock) neither tests nor
// redeploys the API (apps/api/docs/DEPLOY.md "What triggers an API deploy").
//
//   node scripts/checks/api-deps-changed.mjs <base-ref> [<head-ref>=HEAD]
//
// The API image runs `bun install --frozen-lockfile --production --filter '@ceitba/api'`
// (apps/api/Dockerfile), so what it gets is the production dependency closure of the
// @ceitba/api workspace in bun.lock: its dependencies, optionalDependencies and
// peerDependencies, then those of every package reached, never devDependencies. Changed:
//   - any package of that closure added, removed, or with a different lock entry (version,
//     resolution, dependencies, integrity);
//   - apps/api/package.json besides its devDependencies (any change there also matches the
//     apps/api/** path filter, so CI still type-checks a devDependency bump), or the root
//     package.json's packageManager (the bun that
//     resolves the install) / overrides / resolutions / patchedDependencies / trustedDependencies;
//   - the lockfile's own version or its overrides, catalogs, patched or trusted sections.
// Anything it cannot read (a missing or unparsable lockfile, an unknown base such as the
// all-zero SHA of a new branch) answers true: when in doubt, the API is built and shipped.
// Plain Node 18+, no dependencies.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const API_WORKSPACE = 'apps/api';
const PROD_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const ROOT_FIELDS = ['packageManager', 'overrides', 'resolutions', 'patchedDependencies', 'trustedDependencies'];
const LOCK_FIELDS = ['lockfileVersion', 'overrides', 'catalog', 'catalogs', 'patchedDependencies', 'trustedDependencies'];

/** bun.lock is JSON with trailing commas (JSONC): drop them (outside strings) and parse. */
export function parseLock(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

/** The package names along a lock key: "@grpc/grpc-js/@grpc/proto-loader" -> ["@grpc/grpc-js", "@grpc/proto-loader"]. */
export function keyChain(key) {
  const parts = key.split('/');
  const chain = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('@') && i + 1 < parts.length) chain.push(parts[i] + '/' + parts[++i]);
    else chain.push(parts[i]);
  }
  return chain;
}

/** The metadata object of a packages entry (["name@version", registry, {dependencies...}, integrity]). */
function metaOf(entry) {
  return Array.isArray(entry) ? entry.find((x) => x != null && typeof x === 'object' && !Array.isArray(x)) ?? {} : {};
}

/**
 * Lock key installed for dependency `name` as seen from `chain` (the requiring package's
 * key): nested installs first ("<parent>/<name>", then each ancestor), the hoisted one last.
 */
function resolve(packages, chain, name) {
  for (let n = chain.length; n >= 0; n--) {
    const key = [...chain.slice(0, n), name].join('/');
    if (key in packages) return key;
  }
  return null;
}

/**
 * The production closure of a workspace, independent of where bun hoists each package: a Map
 * of facts, "package <name@version>" -> its lock entry (resolution, dependencies, integrity) and
 * "dep <from> > <name>" -> the name@version it resolves to (nested installs first). So a
 * re-hoist that leaves every package the same version is no change. Skipped: optional peers (a
 * package uses one only when another path installs it, which counts it) and type declarations
 * (@types/*, never loaded at runtime: Bun runs the TypeScript without type-checking). A
 * dependency that does not resolve is kept as "unresolved" (a missing optional one is skipped).
 */
export function apiClosure(lock, workspace = API_WORKSPACE) {
  const ws = lock?.workspaces?.[workspace];
  if (ws == null) throw new Error(`bun.lock has no workspace "${workspace}"`);
  const packages = lock.packages ?? {};
  const out = new Map();
  const seen = new Set();
  const queue = [];
  const identOf = (key) => (Array.isArray(packages[key]) ? String(packages[key][0]) : key);
  const visitDeps = (from, chain, meta) => {
    const optionalPeers = new Set(meta.optionalPeers ?? []);
    for (const field of PROD_FIELDS) {
      for (const name of Object.keys(meta[field] ?? {})) {
        if (field === 'peerDependencies' && optionalPeers.has(name)) continue;
        if (name.startsWith('@types/')) continue;
        const key = resolve(packages, chain, name);
        if (key == null) {
          if (field !== 'optionalDependencies') out.set(`dep ${from} > ${name}`, `unresolved ${JSON.stringify(meta[field][name])}`);
          continue;
        }
        out.set(`dep ${from} > ${name}`, identOf(key));
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
  };
  visitDeps(ws.name ?? workspace, [ws.name ?? workspace], ws);
  while (queue.length > 0) {
    const key = queue.shift();
    const entry = packages[key];
    const ident = identOf(key);
    const wsPath = ident.includes('@workspace:') ? ident.slice(ident.indexOf('@workspace:') + '@workspace:'.length) : null;
    if (wsPath != null) {
      // A workspace package the API depends on: its own production dependencies count too.
      const other = lock.workspaces?.[wsPath];
      out.set(`package ${ident}`, JSON.stringify([entry, other ?? null]));
      if (other != null) visitDeps(ident, [other.name ?? wsPath], other);
      continue;
    }
    out.set(`package ${ident}`, JSON.stringify(entry));
    visitDeps(ident, keyChain(key), metaOf(entry));
  }
  return out;
}

/** A package.json without its devDependencies, as canonical JSON (null when missing). */
function withoutDev(text) {
  if (text == null) return null;
  const { devDependencies: _dev, ...rest } = JSON.parse(text);
  return JSON.stringify(rest);
}

function pick(obj, fields) {
  return JSON.stringify(fields.map((f) => [f, obj?.[f] ?? null]));
}

/**
 * Whether the API's installed dependencies differ between two revisions. Each side is
 * { lock: text|null, rootPkg: text|null, apiPkg: text|null }. Returns { changed, reasons }.
 */
export function apiDepsChanged(base, head) {
  const reasons = [];
  let baseRoot;
  let headRoot;
  try {
    baseRoot = JSON.parse(base.rootPkg ?? 'null');
    headRoot = JSON.parse(head.rootPkg ?? 'null');
    if (withoutDev(base.apiPkg) !== withoutDev(head.apiPkg)) reasons.push('apps/api/package.json changed (besides devDependencies)');
  } catch (e) {
    return { changed: true, reasons: [`package.json is not readable: ${e.message}`] };
  }
  for (const f of ROOT_FIELDS) {
    if (pick(baseRoot, [f]) !== pick(headRoot, [f])) reasons.push(`package.json ${f} changed`);
  }
  let baseLock;
  let headLock;
  try {
    if (base.lock == null || head.lock == null) throw new Error('bun.lock missing');
    baseLock = parseLock(base.lock);
    headLock = parseLock(head.lock);
  } catch (e) {
    return { changed: true, reasons: [...reasons, `bun.lock is not readable: ${e.message}`] };
  }
  for (const f of LOCK_FIELDS) {
    if (pick(baseLock, [f]) !== pick(headLock, [f])) reasons.push(`bun.lock ${f} changed`);
  }
  let before;
  let after;
  try {
    before = apiClosure(baseLock);
    after = apiClosure(headLock);
  } catch (e) {
    return { changed: true, reasons: [...reasons, e.message] };
  }
  for (const [key, v] of after) {
    if (!before.has(key)) reasons.push(`added ${key}`);
    else if (before.get(key) !== v) reasons.push(`changed ${key}`);
  }
  for (const key of before.keys()) if (!after.has(key)) reasons.push(`removed ${key}`);
  return { changed: reasons.length > 0, reasons };
}

function show(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

function revision(ref) {
  return { lock: show(ref, 'bun.lock'), rootPkg: show(ref, 'package.json'), apiPkg: show(ref, `${API_WORKSPACE}/package.json`) };
}

function commitExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [baseRef, headRef = 'HEAD'] = process.argv.slice(2);
  let result;
  if (!baseRef || /^0+$/.test(baseRef) || !commitExists(baseRef)) {
    result = { changed: true, reasons: [`no usable base revision (${baseRef || 'none'})`] };
  } else if (!commitExists(headRef)) {
    result = { changed: true, reasons: [`unknown head revision ${headRef}`] };
  } else {
    result = apiDepsChanged(revision(baseRef), revision(headRef));
  }
  const shown = result.reasons.slice(0, 20);
  for (const r of shown) process.stderr.write(`api-deps-changed: ${r}\n`);
  if (result.reasons.length > shown.length) process.stderr.write(`api-deps-changed: ... and ${result.reasons.length - shown.length} more\n`);
  if (!result.changed) process.stderr.write('api-deps-changed: the API dependency closure is unchanged\n');
  process.stdout.write(`${result.changed}\n`);
}

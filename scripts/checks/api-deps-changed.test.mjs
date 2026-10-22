// node --test scripts/checks/ (run by `bun run check` and pr-checks.yml).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiClosure, apiDepsChanged, keyChain, parseLock } from './api-deps-changed.mjs';

const ROOT_PKG = JSON.stringify({ name: 'ceitba', packageManager: 'bun@1.4.2', workspaces: ['apps/web', 'apps/api'] });
const API_PKG = JSON.stringify({ name: '@ceitba/api', dependencies: { hono: '4.13.13', linkedom: '0.18.13' }, devDependencies: { typescript: '5.9.3' } });

// A small bun.lock in bun's text format (JSONC, trailing commas). `v` overrides package versions.
function lock(v = {}) {
  const ver = (name, def) => v[name] ?? def;
  const pkg = (key, name, version, meta = {}) =>
    `    "${key}": ["${name}@${version}", "", ${JSON.stringify(meta)}, "sha512-${name}-${version}"],\n`;
  return `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "ceitba",
    },
    "apps/api": {
      "name": "@ceitba/api",
      "dependencies": {
        "hono": "4.13.13",
        "linkedom": "0.18.13",
      },
      "devDependencies": {
        "typescript": "${ver('typescript', '5.9.3')}",
      },
    },
    "apps/web": {
      "name": "@ceitba/web",
      "dependencies": {
        "react": "${ver('react', '19.1.0')}",
        "hono": "4.13.13",
      },
      "devDependencies": {
        "vite": "${ver('vite', '8.0.0')}",
      },
    },
  },
  "packages": {
${pkg('hono', 'hono', ver('hono', '4.13.13'))}
${pkg('linkedom', 'linkedom', '0.18.13', { dependencies: { htmlparser2: '^10.0.0', 'css-select': '^5.1.0' }, peerDependencies: { canvas: '>= 2' }, optionalPeers: ['canvas'] })}
${pkg('linkedom/htmlparser2', 'htmlparser2', ver('htmlparser2', '10.0.0'), { dependencies: { entities: '^6.0.0' } })}
${pkg('linkedom/htmlparser2/entities', 'entities', ver('entities-nested', '6.0.1'))}
${pkg('entities', 'entities', ver('entities', '4.5.0'))}
${pkg('htmlparser2', 'htmlparser2', ver('htmlparser2-hoisted', '8.0.2'), { dependencies: { entities: '^4.4.0' } })}
${pkg('css-select', 'css-select', ver('css-select', '5.1.0'), { dependencies: { 'nth-check': '^2.0.1' } })}
${pkg('nth-check', 'nth-check', ver('nth-check', '2.1.1'))}
${pkg('canvas', 'canvas', ver('canvas', '3.0.0'))}
${pkg('react', 'react', ver('react', '19.1.0'))}
${pkg('vite', 'vite', ver('vite', '8.0.0'), { dependencies: { esbuild: '^0.25.0' } })}
${pkg('esbuild', 'esbuild', ver('esbuild', '0.25.0'))}
${pkg('typescript', 'typescript', ver('typescript', '5.9.3'))}
  }
}
`;
}

const rev = (l, root = ROOT_PKG, api = API_PKG) => ({ lock: l, rootPkg: root, apiPkg: api });
const changed = (base, head) => apiDepsChanged(base, head).changed;

test('parseLock accepts trailing commas but keeps commas inside strings', () => {
  assert.deepEqual(parseLock('{"a": ["x, }", 1,], "b": {"c": "]",},}'), { a: ['x, }', 1], b: { c: ']' } });
});

test('keyChain splits nested installs, scoped names being two segments', () => {
  assert.deepEqual(keyChain('@grpc/grpc-js/@grpc/proto-loader'), ['@grpc/grpc-js', '@grpc/proto-loader']);
  assert.deepEqual(keyChain('linkedom/htmlparser2/entities'), ['linkedom', 'htmlparser2', 'entities']);
});

test('the closure follows nested installs first and skips dev deps and optional peers', () => {
  const facts = [...apiClosure(parseLock(lock())).entries()].filter(([k]) => k.startsWith('dep ')).sort();
  assert.deepEqual(facts, [
    ['dep @ceitba/api > hono', 'hono@4.13.13'],
    ['dep @ceitba/api > linkedom', 'linkedom@0.18.13'],
    ['dep css-select@5.1.0 > nth-check', 'nth-check@2.1.1'],
    ['dep htmlparser2@10.0.0 > entities', 'entities@6.0.1'],
    ['dep linkedom@0.18.13 > css-select', 'css-select@5.1.0'],
    ['dep linkedom@0.18.13 > htmlparser2', 'htmlparser2@10.0.0'],
  ]);
});

test('a re-hoist that keeps every version is no change', () => {
  // The web app now needs nth-check@3 hoisted; the API's copy moves under css-select, same version.
  const moved = lock({ 'nth-check': '3.0.0' }).replace(
    '    "css-select": [',
    '    "css-select/nth-check": ["nth-check@2.1.1", "", {}, "sha512-nth-check-2.1.1"],\n    "css-select": [',
  );
  assert.equal(changed(rev(lock()), rev(moved)), false);
});

test('type declarations are not runtime dependencies', () => {
  const withTypes = (v) => lock().replace('"dependencies":{"htmlparser2"', `"dependencies":{"@types/node":"*","htmlparser2"`)
    .replace('    "react": [', `    "@types/node": ["@types/node@${v}", "", {}, "sha512-t-${v}"],\n    "react": [`);
  assert.equal(changed(rev(withTypes('26.6.4')), rev(withTypes('26.6.5'))), false);
});

test('the same revision is unchanged', () => {
  assert.equal(changed(rev(lock()), rev(lock())), false);
});

test('a web-only dependency bump does not touch the API', () => {
  assert.equal(changed(rev(lock()), rev(lock({ react: '19.2.0', vite: '8.1.0', esbuild: '0.26.0' }))), false);
});

test('a hoisted package only the web app uses does not touch the API', () => {
  // htmlparser2@8 / entities@4 at the top level are not the ones linkedom gets.
  assert.equal(changed(rev(lock()), rev(lock({ 'htmlparser2-hoisted': '8.0.3', entities: '4.5.1' }))), false);
});

test('a bump of a direct API dependency changes it', () => {
  const r = apiDepsChanged(rev(lock()), rev(lock({ hono: '4.13.14' })));
  assert.equal(r.changed, true);
  assert.deepEqual(r.reasons, ['changed dep @ceitba/api > hono', 'added package hono@4.13.14', 'removed package hono@4.13.13']);
});

test('a bump of a transitive or nested API dependency changes it', () => {
  assert.equal(changed(rev(lock()), rev(lock({ 'nth-check': '2.1.2' }))), true);
  assert.equal(changed(rev(lock()), rev(lock({ 'entities-nested': '6.0.2' }))), true);
});

test('an API devDependency bump does not change it', () => {
  const api2 = API_PKG.replace('5.9.3', '6.0.0');
  assert.equal(changed(rev(lock()), rev(lock({ typescript: '6.0.0' }), ROOT_PKG, api2)), false);
});

test('an optional peer that is not otherwise installed does not count', () => {
  assert.equal(changed(rev(lock()), rev(lock({ canvas: '3.1.0' }))), false);
});

test('apps/api/package.json (besides devDependencies) or the root packageManager changing counts', () => {
  const api2 = JSON.stringify({ ...JSON.parse(API_PKG), engines: { bun: '>=1.4' } });
  assert.equal(changed(rev(lock()), rev(lock(), ROOT_PKG, api2)), true);
  const root2 = ROOT_PKG.replace('bun@1.4.2', 'bun@1.4.3');
  assert.deepEqual(apiDepsChanged(rev(lock()), rev(lock(), root2)).reasons, ['package.json packageManager changed']);
});

test('an unreadable lockfile answers true', () => {
  assert.equal(changed(rev(lock()), rev('{ not json')), true);
  assert.equal(changed(rev(null), rev(lock())), true);
});

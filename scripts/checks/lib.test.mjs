// node --test scripts/checks/ (run by `bun run check` and pr-checks.yml).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeNameStatuses } from './lib.mjs';

const MIG = 'apps/api/src/main/resources/db/migration';

test('renaming a file the branch added keeps only the new name, as added', () => {
  const st = mergeNameStatuses([
    `A\t${MIG}/V64__x.sql`,
    `R097\t${MIG}/V64__x.sql\t${MIG}/V67__x.sql`,
  ]);
  assert.deepEqual([...st], [[`${MIG}/V67__x.sql`, 'A']]);
});

test('renaming a file that exists on the base reports it deleted', () => {
  const st = mergeNameStatuses([`R100\t${MIG}/V10__old.sql\t${MIG}/V10__new.sql`]);
  assert.equal(st.get(`${MIG}/V10__old.sql`), 'D');
  assert.equal(st.get(`${MIG}/V10__new.sql`), 'A');
});

test('a file the branch added stays added through later edits', () => {
  const st = mergeNameStatuses([`A\t${MIG}/V64__x.sql`, `M\t${MIG}/V64__x.sql`]);
  assert.equal(st.get(`${MIG}/V64__x.sql`), 'A');
});

test('editing a file from the base reports it modified', () => {
  const st = mergeNameStatuses([`M\t${MIG}/V10__old.sql`]);
  assert.equal(st.get(`${MIG}/V10__old.sql`), 'M');
});

// contract/COMPATIBILITY.md's error table is generated from src/http/errors.ts and the feature error enums: a new
// error code (or a changed status/message) must show up there. Regenerate with
// `bun contract/compatibility-errors.ts --write`.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DOC, errorBlock, errorTable } from '../../contract/compatibility-errors';

test('the COMPATIBILITY.md error table is current', () => {
  expect(errorBlock(readFileSync(DOC, 'utf8'))).toBe(errorTable());
});

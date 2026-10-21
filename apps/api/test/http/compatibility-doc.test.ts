// contract/COMPATIBILITY.md's error table is generated from src/http/errors.ts and the feature error enums: a new
// error code (or a changed status/message) must show up there. Regenerate with
// `bun contract/compatibility-errors.ts --write`.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DOC, errorBlock, errorTable, rows } from '../../contract/compatibility-errors';

test('the COMPATIBILITY.md error table is current', () => {
  expect(errorBlock(readFileSync(DOC, 'utf8'))).toBe(errorTable());
});

// The generator lists classes by hand: a new error class anywhere in src must be added to it.
test('every error class of the app is in the generator', () => {
  const SRC = join(import.meta.dir, '..', '..', 'src');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  const classes = new Set<string>();
  for (const f of walk(SRC)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/class (\w+) extends (?:CodedError|ApiError|MailQuotaExhaustedError|EmailSendError)\b/g)) classes.add(m[1]!);
  }
  // Abstract/base classes and subclasses already listed under their parent's row.
  for (const base of ['CodedError', 'MailQuotaExhausted', 'MailSenderNotConnected', 'EmailSendError']) classes.delete(base);
  const sources = rows().map((r) => r.source).join('\n');
  expect([...classes].filter((c) => !sources.includes(c)).sort()).toEqual([]);
});

// Records every request a contract test sends (method + concrete path) so
// contract/coverage.ts can tell which OpenAPI operations have >= 1 test.

import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const DIR = join(import.meta.dir, '..', '.hits');

export function recordHit(target: string, method: string, path: string, status: number) {
  try {
    mkdirSync(DIR, { recursive: true });
    const file = join(DIR, `${target}-${basename(process.argv[1] ?? 'run')}-${process.pid}.jsonl`);
    appendFileSync(file, `${JSON.stringify({ method, path: path.split('?')[0], status })}\n`);
  } catch {
    // coverage is best effort
  }
}

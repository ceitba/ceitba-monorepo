// Records every request a contract test sends (method + concrete path) so
// contract/coverage.ts can tell which OpenAPI operations have >= 1 test.
// Each `bun contract/run.ts` writes into its own directory (CONTRACT_RUN_ID),
// so overlapping runs never wipe each other's hits; coverage.ts merges them all.

import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export const HITS_DIR = join(import.meta.dir, '..', '.hits');

/** This run's directory under .hits (`adhoc` for a plain `bun test` of a contract file). */
export const runDir = (root: string) => join(root, process.env.CONTRACT_RUN_ID ?? 'adhoc');

export function recordHit(target: string, method: string, path: string, status: number) {
  try {
    const dir = runDir(HITS_DIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${target}-${basename(process.argv[1] ?? 'run')}-${process.pid}.jsonl`);
    appendFileSync(file, `${JSON.stringify({ method, path: path.split('?')[0], status })}\n`);
  } catch {
    // coverage is best effort
  }
}

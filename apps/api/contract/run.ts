// Contract suite runner: one Postgres + one migrated template for the whole
// run, test files sharded across N parallel `bun test` workers (each file
// boots its own server(s) on a fresh database clone, so files are independent).
//
//   bun contract/run.ts                       # CONTRACT_TARGET (default ts)
//   CONTRACT_JAR=<jar> bun contract/run.ts --target java   # against a Spring Boot jar built from the last
//                                                          # Java commit (the Java app is deleted)
//   CONTRACT_JAR=<jar> bun contract/run.ts --target both   # java, then ts
//   bun contract/run.ts --workers 4 career    # only files whose name contains "career"
//
// Env: CONTRACT_PG_URL (reuse a server), CONTRACT_PARALLEL (default workers),
// CONTRACT_JAVA_HOME, CONTRACT_JAR.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { pgServerUrl, templateDatabase } from './support/pg';
import { JAVA_AVAILABLE, JAVA_TARGET_REMOVED } from './support/server';

const ROOT = join(import.meta.dir, '..');
const TESTS = join(import.meta.dir, 'tests');

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const targetArg = opt('--target') ?? process.env.CONTRACT_TARGET ?? 'ts';
const workers = Number(opt('--workers') ?? process.env.CONTRACT_PARALLEL ?? Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))));
const filters = args.filter((a) => !a.startsWith('--'));
const targets = targetArg === 'both' ? ['java', 'ts'] : [targetArg];
if (targets.includes('java') && !JAVA_AVAILABLE) {
  console.error(JAVA_TARGET_REMOVED);
  process.exit(2);
}

const files = readdirSync(TESTS).filter((f) => f.endsWith('.contract.test.ts')).filter((f) => !filters.length || filters.some((x) => f.includes(x))).sort();
if (!files.length) {
  console.error('No contract test files match.');
  process.exit(1);
}

const t0 = performance.now();
const pgUrl = await pgServerUrl();
const template = await templateDatabase();
const templateMs = process.env.CONTRACT_TEMPLATE_MS ? `${process.env.CONTRACT_TEMPLATE_MS} ms (built now)` : 'reused';
console.log(`Postgres ready, template ${template} (${templateMs}) in ${Math.round(performance.now() - t0)} ms; ${files.length} files, ${workers} workers`);

// Each run writes hits and logs into its own directory, so overlapping runs never wipe each other's
// (coverage.ts merges every run's hits). Directories of runs older than a day are pruned.
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
for (const d of ['.hits', '.logs']) {
  const root = join(import.meta.dir, d);
  if (!existsSync(root)) continue;
  for (const f of readdirSync(root)) {
    const p = join(root, f);
    if (Date.now() - statSync(p).mtimeMs > 24 * 3600_000) rmSync(p, { recursive: true, force: true });
  }
}

let failed = false;
for (const target of targets) {
  const logDir = join(import.meta.dir, '.logs', RUN_ID);
  const shards: string[][] = Array.from({ length: Math.min(workers, files.length) }, () => []);
  files.forEach((f, i) => shards[i % shards.length]!.push(join(TESTS, f)));
  const started = performance.now();
  const results = await Promise.all(shards.map(async (shard) => {
    const p = Bun.spawn([process.execPath, 'test', '--timeout', '120000', ...shard], {
      cwd: ROOT,
      env: { ...process.env, CONTRACT_TARGET: target, CONTRACT_PG_URL: pgUrl, CONTRACT_TEMPLATE_DB: template, CONTRACT_RUN_ID: RUN_ID },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: out + err };
  }));
  let pass = 0, fail = 0, skip = 0;
  for (const r of results) {
    pass += Number(/(\d+) pass/.exec(r.out)?.[1] ?? 0);
    fail += Number(/(\d+) fail/.exec(r.out)?.[1] ?? 0);
    skip += Number(/(\d+) skip/.exec(r.out)?.[1] ?? 0);
    if (r.code !== 0) {
      failed = true;
      console.log(r.out.split('\n').filter((l) => !l.startsWith('(pass)')).join('\n'));
    }
  }
  const boots = existsSync(join(logDir, `boot-${target}.jsonl`))
    ? readFileSync(join(logDir, `boot-${target}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l).bootMs as number)
    : [];
  const avg = boots.length ? Math.round(boots.reduce((a, b) => a + b, 0) / boots.length) : 0;
  console.log(`[${target}] ${pass} pass, ${fail} fail, ${skip} skip in ${Math.round(performance.now() - started)} ms`
    + ` (${boots.length} server boots, avg ${avg} ms, max ${boots.length ? Math.max(...boots) : 0} ms)`);
}

// A Postgres container this process started is removed by Testcontainers' Ryuk when it exits.
process.exit(failed ? 1 : 0);

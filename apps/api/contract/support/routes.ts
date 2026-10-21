// Which routes the TS app implements, so a contract test that needs an
// endpoint from a feature not ported yet is skipped on CONTRACT_TARGET=ts
// (and always runs on java). Route registration must not touch the database:
// keep routes.ts / service constructors free of I/O.

import { loadConfig } from '../../src/config';
import { collectRoutes } from '../../src/http/app';
import { springPathRegExp, type RouteDef } from '../../src/http/router';
import { silentLogger } from '../../src/infra/logger';
import { CONTRACT_ENV } from './env';
import { TARGET } from './server';

let routes: Promise<RouteDef[]> | undefined;

async function tsRoutes(): Promise<RouteDef[]> {
  routes ??= (async () => {
    const config = await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/none' });
    const deps = new Proxy({ config, log: silentLogger } as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : new Proxy(() => {}, { get: () => () => {} })),
    });
    return collectRoutes(deps as never);
  })();
  return routes;
}

/** True on java; on ts, true when every "METHOD /concrete/path" has a TS handler. */
export async function supports(...ops: string[]): Promise<boolean> {
  if (TARGET === 'java') return true;
  const rs = await tsRoutes();
  return ops.every((op) => {
    const [method, path] = op.split(' ') as [string, string];
    return rs.some((r) => r.method === method.toUpperCase() && springPathRegExp(r.path).test(path));
  });
}

export { tsRoutes };

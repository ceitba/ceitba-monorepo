// config/ShutdownDrain + ShutdownDrainTest: on shutdown, readiness answers 503
// OUT_OF_SERVICE while requests are still served for SHUTDOWN_DRAIN, then the
// server stops.
import { expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { cloneDatabase, dropDatabase, jdbcParts, pgServerUrl, withDatabase } from '../../contract/support/pg';
import { start } from '../../src/main';
import { silentLogger } from '../../src/infra/logger';

test('readinessGoesDownDuringTheDrainThenTheServerStops', async () => {
  const db = await cloneDatabase('sd');
  const { jdbc, user, password } = jdbcParts(withDatabase(await pgServerUrl(), db));
  const s = await start({
    env: { ...CONTRACT_ENV, DATABASE_URL: jdbc, POSTGRES_USER: user, POSTGRES_PASSWORD: password, PORT: '0', SHUTDOWN_DRAIN: 'PT1S' },
    overrides: { log: silentLogger },
    jobs: false,
  });
  try {
    expect((await fetch(`${s.url}/api/actuator/health/readiness`)).status).toBe(200);
    const stopping = s.shutdown('test');
    const ready = await fetch(`${s.url}/api/actuator/health/readiness`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'OUT_OF_SERVICE' });
    expect((await fetch(`${s.url}/api/v1/careers`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/actuator/health`)).status).toBe(503);
    await stopping;
    await expect(fetch(`${s.url}/api/v1/careers`)).rejects.toThrow();
  } finally {
    await dropDatabase(db);
  }
}, 30_000);

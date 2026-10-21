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

// ShutdownDrainTest: the drain is waited before the graceful stop, and the HTTP
// server is stopped only after it (Java: ShutdownDrain stops in a higher phase than
// WebServerGracefulShutdownLifecycle).
async function startWithDrain(drain: string) {
  const db = await cloneDatabase('sd');
  const { jdbc, user, password } = jdbcParts(withDatabase(await pgServerUrl(), db));
  const s = await start({
    env: { ...CONTRACT_ENV, DATABASE_URL: jdbc, POSTGRES_USER: user, POSTGRES_PASSWORD: password, PORT: '0', SHUTDOWN_DRAIN: drain },
    overrides: { log: silentLogger },
    jobs: false,
  });
  return { s, drop: () => dropDatabase(db) };
}

test('waitsTheDrainWhenStopping', async () => {
  const { s, drop } = await startWithDrain('PT0.2S');
  try {
    const t0 = performance.now();
    await s.shutdown('test');
    expect(performance.now() - t0).toBeGreaterThanOrEqual(200);
    expect(s.deps.availability.acceptingTraffic).toBe(false);
  } finally {
    await drop();
  }
}, 30_000);

test('stopsBeforeTheGracefulWebServerShutdown', async () => {
  const { s, drop } = await startWithDrain('PT0.3S');
  try {
    const stopping = s.shutdown('test');
    // Still serving during the drain: the web server's graceful stop comes after it.
    expect((await fetch(`${s.url}/api/v1/careers`)).status).toBe(200);
    await stopping;
    await expect(fetch(`${s.url}/api/v1/careers`)).rejects.toThrow();
  } finally {
    await drop();
  }
}, 30_000);

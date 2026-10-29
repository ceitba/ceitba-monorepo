// The ITBA token is a path segment of every ITBA URL: it must never reach an error message, an error's cause
// (Bun's fetch errors carry the full URL in `path`) or a log line.
import { afterAll, describe, expect, test } from 'bun:test';
import { Writable } from 'node:stream';
import pino from 'pino';
import { RestItbaApiClient } from '../../src/external/itba/restClient';
import { MutableClock } from '../../src/infra/clock';
import { errSerializer } from '../../src/infra/logger';

const TOKEN = 'sekret-itba-token-123';
const server = Bun.serve({ port: 0, fetch: () => new Response('boom', { status: 500 }) });
afterAll(() => server.stop(true));

/** The error, its causes and their enumerable fields, as one string. */
function everything(e: unknown): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 10; x = (x as Error).cause, i++) {
    parts.push(String((x as Error).message), JSON.stringify(Object.assign({}, x)));
  }
  return parts.join('\n');
}

describe('ITBA token redaction', () => {
  test('anHttpErrorDoesNotCarryTheToken', async () => {
    const client = new RestItbaApiClient({ baseUrl: server.url.toString(), token: TOKEN, timeoutMs: 2000 }, new MutableClock());
    const e = await client.getSubjectsByPlan('S10').catch((x) => x);
    expect(everything(e)).toContain('500');
    expect(everything(e)).not.toContain(TOKEN);
  });

  test('anIoErrorDoesNotCarryTheToken', async () => {
    const client = new RestItbaApiClient({ baseUrl: 'http://127.0.0.1:1', token: TOKEN, timeoutMs: 2000 }, new MutableClock());
    const e = await client.getSubjectsByPlan('S10').catch((x) => x);
    expect(everything(e)).toContain('***');
    expect(everything(e)).not.toContain(TOKEN);
  });

  test('loggedErrorsLoseUrlQueryStrings', () => {
    const lines: string[] = [];
    const log = pino({ serializers: { err: errSerializer } },
      new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } }));
    const fetchError = Object.assign(new Error('Unable to connect'), { path: 'https://bucket.example/obj?X-Amz-Signature=SIG123' });
    log.error({ err: fetchError }, 'x');
    expect(lines.join('')).toContain('https://bucket.example/obj');
    expect(lines.join('')).not.toContain('SIG123');
  });
});

// Port of ReviewLoginServiceTest (unit, Mockito in Java): exactly one bcrypt check
// whatever the input, the dummy hash at the configured cost, disabled and
// misconfigured hashes, and the misconfiguration message. The bcrypt checks are
// recorded with a spy (Java's RecordingEncoder); provisioning is the real one on
// a database clone (Java mocks it). One difference that is not observable: the
// dummy hash is bcryptjs's `$2b$` where Spring writes `$2a$` (same algorithm).
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import bcrypt from 'bcryptjs';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import { AuthService, misconfiguration } from '../../src/features/auth/service';
import { InvalidCredentialsError, ReviewLoginDisabledError } from '../../src/http/errors';
import { testApp, type TestApp } from '../support/app';

const EMAIL = 'appreview@example.com';
const PASSWORD = 's3cret-review-pass';
const HASH = bcrypt.hashSync(PASSWORD, 4).replace(/^\$2b\$/, '$2a$');

let t: TestApp;
const checkedAgainst: string[] = [];
let spy: { mockRestore(): void } | undefined;

beforeAll(async () => {
  t = await testApp();
  const real = bcrypt.compareSync.bind(bcrypt);
  spy = spyOn(bcrypt, 'compareSync').mockImplementation((raw: string, hash: string) => {
    checkedAgainst.push(hash);
    return real(raw, hash);
  });
}, 60_000);
afterAll(async () => {
  spy?.mockRestore();
  await t?.close();
});
beforeEach(async () => {
  checkedAgainst.length = 0;
  await t.sql`TRUNCATE public."user" CASCADE`;
});

async function service(email: string | null, hash: string | null) {
  const env: Record<string, string> = { ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x' };
  if (email !== null) env.REVIEW_LOGIN_EMAIL = email;
  if (hash !== null) env.REVIEW_LOGIN_PASSWORD_HASH = hash;
  const config = await loadConfig(env);
  return { config, svc: new AuthService({ ...t.deps, config }) };
}
const authenticate = (svc: AuthService, email: string | null, password: string | null) =>
  (svc as unknown as { authenticateReview(e: string | null, p: string | null): Promise<{ email: string }> }).authenticateReview(email, password);
const users = async () => (await t.sql`SELECT email FROM public."user"`).map((r) => r.email as string);

describe('ReviewLoginServiceTest', () => {
  test('correctCredentialsProvisionTheReviewUser', async () => {
    const { svc } = await service(EMAIL, HASH);
    expect((await authenticate(svc, ' AppReview@Example.com ', PASSWORD)).email).toBe(EMAIL);
    expect(checkedAgainst).toEqual([HASH]);
    expect(await users()).toEqual([EMAIL]);
  });

  test('unknownEmailStillRunsExactlyOneBcryptCheckOfTheSameCost', async () => {
    const { svc } = await service(EMAIL, HASH);
    await expect(authenticate(svc, 'someone@gmail.com', PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(checkedAgainst).toHaveLength(1);
    expect(checkedAgainst[0]).not.toBe(HASH);
    expect(checkedAgainst[0]).toMatch(/^\$2[ab]\$04\$/);
    expect(await users()).toEqual([]);
  });

  test('wrongPasswordRunsOneCheckAgainstTheRealHash', async () => {
    const { svc } = await service(EMAIL, HASH);
    await expect(authenticate(svc, EMAIL, 'nope')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(checkedAgainst).toEqual([HASH]);
    expect(await users()).toEqual([]);
  });

  test('missingOrOverlongInputStillRunsOneCheck', async () => {
    const { svc } = await service(EMAIL, HASH);
    await expect(authenticate(svc, null, null)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(authenticate(svc, EMAIL, null)).rejects.toBeInstanceOf(InvalidCredentialsError);
    // > 72 bytes: bcrypt would ignore the tail, so it is rejected outright (still after a check).
    await expect(authenticate(svc, EMAIL, PASSWORD + 'x'.repeat(80))).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(checkedAgainst).toHaveLength(3);
    expect(await users()).toEqual([]);
  });

  test('disabledUnlessBothPropertiesAreSet', async () => {
    for (const [email, hash] of [[null, null], [EMAIL, ' '], ['', HASH]] as const) {
      const { svc } = await service(email, hash);
      await expect(authenticate(svc, EMAIL, PASSWORD)).rejects.toBeInstanceOf(ReviewLoginDisabledError);
    }
    expect(checkedAgainst).toEqual([]);
    expect(await users()).toEqual([]);
  });

  test.each(['$2a', '$2b', '$2y'])('acceptsEveryStandardBcryptVariant %s', async (version) => {
    const hash = bcrypt.hashSync(PASSWORD, 4).replace(/^\$2b/, version);
    expect(hash.startsWith(`${version}$04$`)).toBe(true);
    expect(hash).toHaveLength(60);
    const { config, svc } = await service(EMAIL, `  ${hash}\n`);
    expect(config.auth.reviewLogin.status).toBe('ENABLED');
    expect(await authenticate(svc, EMAIL, PASSWORD)).not.toBeNull();
    await expect(authenticate(svc, EMAIL, 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  const mangled = [
    'plain-text-password',
    `${HASH.slice(0, 7)}%`, // unquoted in .env: compose expanded `$<salt+hash>` to "", plus zsh `%`
    `a2$${HASH.slice(4)}`, // mangled prefix
    HASH.slice(7), // `$2a$04$` eaten
    `${HASH}%`, // zsh's end-of-line marker pasted along
    `${HASH}x`,
    HASH.slice(0, 59), // truncated
    HASH.replace('$04$', '$4$'), // one-digit cost
    HASH.replace('$04$', '$03$'), // cost below 04
    HASH.replace('$04$', '$32$'), // cost above 31
    `$2$${HASH.slice(4)}`, // no minor version
    `$2x$${HASH.slice(4)}`, // unknown variant
    `${HASH.slice(0, 30)}!${HASH.slice(31)}`, // char outside bcrypt's base64
  ];
  const mangledCases = mangled.map((m, i) => [i, m] as const);
  test.each(mangledCases)('aMangledHashDisablesReviewLoginInsteadOfFailingStartup #%d', async (_i, hash) => {
    const { config, svc } = await service(EMAIL, hash);
    expect(config.auth.reviewLogin.status).toBe('MISCONFIGURED');
    await expect(authenticate(svc, EMAIL, PASSWORD)).rejects.toBeInstanceOf(ReviewLoginDisabledError);
    expect(checkedAgainst).toEqual([]);
    expect(await users()).toEqual([]);
  });

  test('onlyOneOfEmailAndHashIsMisconfigured', async () => {
    expect((await service(EMAIL, '')).config.auth.reviewLogin.status).toBe('MISCONFIGURED');
    expect((await service(' ', HASH)).config.auth.reviewLogin.status).toBe('MISCONFIGURED');
    expect((await service(null, null)).config.auth.reviewLogin.status).toBe('DISABLED');
    expect((await service('', '  ')).config.auth.reviewLogin.status).toBe('DISABLED');
  });

  test('theMisconfigurationMessageExplainsTheCauseWithoutLeakingTheHash', () => {
    const msg = misconfiguration({ email: EMAIL, passwordHash: `${HASH}%` });
    expect(msg).not.toContain(HASH.slice(7));
    for (const s of ['SINGLE quotes', '61 chars', '%', 'docker compose config']) expect(msg).toContain(s);
    expect(misconfiguration({ email: EMAIL })).toContain('REVIEW_LOGIN_PASSWORD_HASH is empty');
    const noEmail = misconfiguration({ passwordHash: HASH });
    expect(noEmail).toContain('REVIEW_LOGIN_EMAIL is empty');
    expect(noEmail).not.toContain(HASH.slice(7));
  });

  test('productionConstructorUsesTheConfiguredCostForTheDummyHash', async () => {
    const { svc } = await service(EMAIL, HASH);
    await expect(authenticate(svc, 'other@example.com', PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(checkedAgainst[0]).toMatch(/^\$2[ab]\$04\$/);
    expect(await authenticate(svc, EMAIL, PASSWORD)).not.toBeNull();
  });
});

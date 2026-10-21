// Not in the Java suite (plan §5 phase 1): tokens and sessions cross over.
// A token issued by one implementation is accepted by the other, so a rollout
// (or a rollback) logs nobody out. Needs a Java jar (CONTRACT_JAR): skipped without it.
import { describe, expect, test } from 'bun:test';
import bcrypt from 'bcryptjs';
import { bearer, useServer } from '../support';
import { JAVA_AVAILABLE } from '../support/server';

const run = JAVA_AVAILABLE && process.env.CONTRACT_SKIP_CROSS !== '1';
const env = { REVIEW_LOGIN_EMAIL: 'appreview@example.com', REVIEW_LOGIN_PASSWORD_HASH: bcrypt.hashSync('pw', 4) };
const java = run ? useServer({ target: 'java', env }) : null;
const ts = run ? useServer({ target: 'ts', env }) : null;

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString());

describe.skipIf(!run)('cross-signing', () => {
  test('aJavaTokenWorksOnTsAndTheReverse', async () => {
    const fromJava = await java!.post('/v1/auth/review-login', { body: { email: 'appreview@example.com', password: 'pw' } });
    const fromTs = await ts!.post('/v1/auth/review-login', { body: { email: 'appreview@example.com', password: 'pw' } });
    expect(fromJava.status).toBe(200);
    expect(fromTs.status).toBe(200);
    // Same header and claim layout.
    const hj = JSON.parse(Buffer.from(fromJava.json.accessToken.split('.')[0], 'base64url').toString());
    const ht = JSON.parse(Buffer.from(fromTs.json.accessToken.split('.')[0], 'base64url').toString());
    expect(ht).toEqual(hj);
    expect(Object.keys(decode(fromTs.json.accessToken))).toEqual(Object.keys(decode(fromJava.json.accessToken)));
    expect((await ts!.get('/v1/auth/me', { as: bearer(fromJava.json.accessToken) })).json.email).toBe('appreview@example.com');
    expect((await java!.get('/v1/auth/me', { as: bearer(fromTs.json.accessToken) })).json.email).toBe('appreview@example.com');
  });
});

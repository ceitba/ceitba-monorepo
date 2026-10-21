// Ports apps/api/src/test/java/org/ceitba/api/web/auth/ApiKeyScopesIT.java.
// Keys are seeded as ApiKeyService.create would store them (seedApiKey).
import { describe, expect, test } from 'bun:test';
import { apiKey, bearer, mintJwt, seedApiKey, seedStaff, seedUser, supports, useServer } from '../support';

const api = useServer();
const hasStaffList = await supports('GET /v1/staff');
const user = (email: string) => seedUser(api.db, email, { name: email });
const key = async (userId: string, ...scopes: string[]) => (await seedApiKey(api.db, userId, scopes.length ? scopes : null)).key;
const uuid = () => crypto.randomUUID();

describe('ApiKeyScopesIT', () => {
  test('readOnlyKeyCanReadButNotWrite', async () => {
    const k = await key(await user(`reader-${uuid()}@itba.edu.ar`), 'read');
    expect((await api.get('/v1/auth/me', { as: apiKey(k) })).status).toBe(200);
    const w = await api.post('/v1/wiki/bookmarks/93.12', { as: apiKey(k) });
    expect(w.status).toBe(403);
    expect(w.json).toMatchObject({ error: 'INSUFFICIENT_SCOPE', message: 'This API key is read-only (missing scope: write)', path: '/api/v1/wiki/bookmarks/93.12' });
    expect((await api.post('/v1/auth/logout-all', { as: apiKey(k) })).status).toBe(403);
  });

  test('readOnlyKeyMayRunReadStylePostQueries', async () => {
    const k = await key(await user(`conflicts-${uuid()}@itba.edu.ar`), 'read');
    const r = await api.post('/v1/classrooms/conflicts', { as: apiKey(k), body: { classroom: '101', building: 'SDF', day: 'MONDAY', hourFrom: '10:00', hourTo: '12:00' } });
    expect(r.status).not.toBe(403);
  });

  test('writeScopeAllowsWrites', async () => {
    const k = await key(await user(`writer-${uuid()}@itba.edu.ar`), 'read', 'write');
    expect((await api.post('/v1/auth/logout-all', { as: apiKey(k) })).status).toBe(204);
  });

  test('staffPowersNeedTheStaffScope', async () => {
    const s = await seedStaff(api.db, `staffer-${uuid()}@itba.edu.ar`);
    const denied = await api.get('/v1/staff', { as: apiKey(await key(s, 'read')) });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('WWW-Authenticate')).toBe('Bearer');
    if (hasStaffList) {
      expect((await api.get('/v1/staff', { as: apiKey(await key(s, 'read', 'staff')) })).status).toBe(200);
      // Full-power (legacy) keys keep STAFF.
      expect((await api.get('/v1/staff', { as: apiKey(await key(s)) })).status).toBe(200);
    }
  });

  test('scopedKeysCannotManageKeys', async () => {
    const u = await user(`minter-${uuid()}@itba.edu.ar`);
    const scoped = await key(u, 'read', 'write');
    const create = await api.post('/v1/auth/api-keys', { as: apiKey(scoped), body: { name: 'escalate' } });
    expect(create.status).toBe(403);
    expect(create.json).toMatchObject({ error: 'INSUFFICIENT_SCOPE', message: 'Scoped API keys cannot create API keys' });
    const del = await api.delete(`/v1/auth/api-keys/${uuid()}`, { as: apiKey(scoped) });
    expect(del.status).toBe(403);
    expect(del.json.message).toBe('Scoped API keys can only revoke themselves');
    const list = await api.get('/v1/auth/api-keys', { as: apiKey(scoped) });
    expect(list.status).toBe(200);
    expect(list.json[0].scopes[0]).toBe('read');
    expect(Object.keys(list.json[0])).toEqual(['id', 'name', 'createdAt', 'expiresAt', 'lastUsedAt', 'scopes']);
    // Read from the DB: OffsetDateTime normalized to UTC.
    expect(list.json[0].createdAt).toMatch(/Z$/);
    expect(list.json[0].lastUsedAt).toMatch(/Z$/);
  });

  test('aStaffMcpKeyCannotManageKeys', async () => {
    const s = await seedStaff(api.db, `mcpstaff-${uuid()}@itba.edu.ar`);
    const mcp = await key(s, 'read', 'report', 'staff', 'write');
    const other = (await seedApiKey(api.db, s, null)).id;
    const create = await api.post('/v1/auth/api-keys', { as: apiKey(mcp), body: { name: 'escalate' } });
    expect(create.status).toBe(403);
    expect(create.json.error).toBe('INSUFFICIENT_SCOPE');
    expect((await api.delete(`/v1/auth/api-keys/${other}`, { as: apiKey(mcp) })).status).toBe(403);
    const ok = await api.post('/v1/auth/api-keys', { as: apiKey(await key(s)), body: { name: 'ok' } });
    expect(ok.status).toBeGreaterThanOrEqual(200);
    expect(ok.status).toBeLessThan(300);
  });

  test('scopedKeysCannotManageKeysThroughAnEncodedPath', async () => {
    const u = await user(`encoded-${uuid()}@itba.edu.ar`);
    const scoped = await key(u, 'read', 'write');
    const create = await api.request('POST', '/api/v1/auth/api%2Dkeys', { rawPath: true, as: apiKey(scoped), body: { name: 'escalate' } });
    expect(create.status).toBe(403);
    expect(create.json.error).toBe('INSUFFICIENT_SCOPE');
    const other = (await seedApiKey(api.db, u, ['read'])).id;
    expect((await api.request('DELETE', `/api/v1/auth/api%2Dkeys/${other}`, { rawPath: true, as: apiKey(scoped) })).status).toBe(403);
    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public.api_keys WHERE user_id = ${u}`;
    expect(n).toBe(2);
  });

  test('aReportKeyMayOnlyReport', async () => {
    const k = await key(await user(`reporter-${uuid()}@itba.edu.ar`), 'read', 'report');
    for (const path of [`/v1/wiki/kb/pages/${uuid()}/report`, `/v1/wiki/files/${uuid()}/report`]) {
      const r = await api.put(path, { as: apiKey(k), body: { reason: 'OTHER' } });
      expect(r.text).not.toContain('INSUFFICIENT_SCOPE');
    }
    const w = await api.post('/v1/auth/logout-all', { as: apiKey(k) });
    expect(w.status).toBe(403);
    expect(w.json).toMatchObject({ error: 'INSUFFICIENT_SCOPE', message: 'This API key can only read and report content (missing scope: write)' });
    expect((await api.post(`/v1/wiki/kb/pages/${uuid()}/report`, { as: apiKey(k) })).json.error).toBe('INSUFFICIENT_SCOPE');
    const enc = await api.request('PUT', `/api/v1/wiki/kb/pages/${uuid()}/repor%74`, { rawPath: true, as: apiKey(k), body: { reason: 'OTHER' } });
    expect(enc.json.error).toBe('INSUFFICIENT_SCOPE');
  });

  test('anEmptyScopeListMeansReadOnly', async () => {
    const u = await user(`empty-${uuid()}@itba.edu.ar`);
    const created = await seedApiKey(api.db, u, []);
    const [row] = await api.db`SELECT scopes FROM public.api_keys WHERE id = ${created.id}`;
    expect(row!.scopes).toBe('read');
    expect((await api.post('/v1/auth/logout-all', { as: apiKey(created.key) })).status).toBe(403);
  });

  test('aStaffMembersKeyWithoutStaffScopeReportsAPlainUser', async () => {
    const s = await seedStaff(api.db, `narrow-${uuid()}@itba.edu.ar`);
    const narrow = await api.get('/v1/auth/me', { as: apiKey(await key(s, 'read')) });
    expect(narrow.status).toBe(200);
    expect(narrow.json).toMatchObject({ role: 'user', moderator: false, apiKeyScopes: ['read'] });
    expect(narrow.json.capabilities).toContain('asistentes_ia');
    const wide = await api.get('/v1/auth/me', { as: apiKey(await key(s, 'read', 'staff')) });
    expect(wide.json).toMatchObject({ role: 'staff', moderator: true });
    expect(wide.json.apiKeyScopes[1]).toBe('staff');
  });

  test('aReadOnlyKeyCanRevokeItself', async () => {
    const created = await seedApiKey(api.db, await user(`selfrevoke-${uuid()}@itba.edu.ar`), ['read']);
    const r = await api.delete(`/v1/auth/api-keys/${created.id}`, { as: apiKey(created.key) });
    expect(r.status).toBe(204);
    expect((await api.get('/v1/auth/me', { as: apiKey(created.key) })).status).toBe(401);
  });

  test('keysOfNonAllowlistedOwnersAreRejected', async () => {
    const k = await key(await user(`outsider-${uuid()}@gmail.com`), 'read');
    const r = await api.get('/v1/auth/me', { as: apiKey(k) });
    expect(r.status).toBe(403);
    expect(r.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect((await api.get('/v1/careers', { as: apiKey(k) })).status).toBe(200);
  });

  test('createWithScopesOverHttp', async () => {
    const alice = bearer(await mintJwt({ email: 'alice-scopes@itba.edu.ar', name: 'Alice' }));
    const r = await api.post('/v1/auth/api-keys', { as: alice, body: { name: 'mcp', scopes: ['staff'] } });
    expect(r.status).toBe(201);
    expect(r.json.scopes).toEqual(['read', 'staff']);
    const bad = await api.post('/v1/auth/api-keys', { as: alice, body: { name: 'mcp', scopes: ['admin'] } });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe("Validation failed for field 'scopes' with value 'admin': must be one of read, report, write, staff, keys");
  });

  // Not in the IT: unknown keys are anonymous; revoking someone else's key is 404 with no body.
  test('unknownKeyIsAnonymousAndForeignKeyRevokeIs404', async () => {
    expect((await api.get('/v1/auth/me', { as: apiKey('ceitba_nope') })).status).toBe(401);
    const a = await user(`a-${uuid()}@itba.edu.ar`);
    const b = await user(`b-${uuid()}@itba.edu.ar`);
    const bk = await seedApiKey(api.db, b, null);
    const r = await api.delete(`/v1/auth/api-keys/${bk.id}`, { as: apiKey(await key(a)) });
    expect(r.status).toBe(404);
    expect(r.text).toBe('');
  });
});

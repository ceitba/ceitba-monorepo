// Bean Validation messages follow the request locale (Accept-Language via
// Spring's LocaleContextHolder into Hibernate's bundles), the JVM default
// (en_US) without one. Not in the Java suite; verified against the jar.
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, useServer } from '../support';

const api = useServer({ setup: async (s) => { await seedStaff(s.db, 'boss@itba.edu.ar'); } });
const msg = async (lang: string | null, body: unknown = { id: '', name: 'ok' }) => {
  const headers: Record<string, string> = lang === null ? {} : { 'Accept-Language': lang };
  const r = await api.post('/v1/careers', { as: bearer(await mintJwt({ email: 'boss@itba.edu.ar' })), headers, body });
  expect(r.status).toBe(400);
  return r.json.message as string;
};

describe('validation messages by locale', () => {
  test.each([
    [null, 'id: must not be blank'],
    ['en', 'id: must not be blank'],
    ['es', 'id: no debe estar vacío'],
    ['es-AR', 'id: no debe estar vacío'],
    ['es-AR,es;q=0.9,en;q=0.8', 'id: no debe estar vacío'],
    ['de;q=0.5, es', 'id: no debe estar vacío'],
    ['fr-FR', 'id: ne doit pas être vide'],
    ['pt-BR', 'id: não deve estar em branco'],
    ['xx', 'id: must not be blank'],
    ['*', 'id: must not be blank'],
  ])('Accept-Language %p', async (lang, expected) => {
    expect(await msg(lang)).toBe(expected);
  });

  test('size message', async () => {
    expect(await msg('es', { id: 'x'.repeat(26), name: 'ok' })).toBe('id: el tamaño debe estar entre 0 y 25');
    expect(await msg('en', { id: 'x'.repeat(26), name: 'ok' })).toBe('id: size must be between 0 and 25');
  });

  test('notBlank uses Java trim (NBSP is not blank, \\u0001 is)', async () => {
    expect(await msg('en', { id: '\u0001', name: 'ok' })).toBe('id: must not be blank');
    const nbsp = await api.post('/v1/careers', { as: bearer(await mintJwt({ email: 'boss@itba.edu.ar' })), body: { id: ' ', name: 'ok' } });
    expect(nbsp.status).toBe(201);
  });
});

// Spring's @RequestParam conversion of an empty value (`?limit=`), verified on
// the jar: an optional object parameter (Integer, UUID) is null, a parameter
// with a defaultValue takes the default, a required primitive fails to convert "".
// Not a Java IT: it pins down the shared binding (src/http/validation.ts `param`).
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, useServer } from '../support';

const api = useServer();

describe('RequestParamBinding', () => {
  test('emptyOptionalObjectParametersAreAbsent', async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');
    const as = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
    const search = await api.get('/v1/wiki/kb/search?q=x&limit=', { as });
    expect(search.status).toBe(200);
    expect(search.text).toBe('{"query":"x","results":[]}');
    expect((await api.get('/v1/plans/S10/subjects?year=', { as })).text).toBe('[]');
    expect((await api.get('/v1/classrooms/availability?minMinutes=', { as })).json.minMinutes).toBe(60);
    expect((await api.get('/v1/staff/kb/evals?setId=', { as })).text).toBe('[]');
    expect((await api.get('/v1/staff/kb/evals/leaderboard?setId=', { as })).text).toBe('{"setId":null,"setName":null,"entries":[]}');
  });

  test('emptyParametersWithADefaultTakeIt', async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');
    const as = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
    expect((await api.get('/v1/news/events?upcoming=', { as })).text).toBe('{"data":[],"meta":{"total":0,"page":1,"limit":50}}');
    expect((await api.get('/v1/staff/kb/pipeline/runs?limit=', { as })).text).toBe('[]');
  });

  test('anEmptyRequiredPrimitiveFailsToConvert', async () => {
    const r = await api.get('/v1/staff-members?year=');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('BadRequest');
    expect(r.json.message).toBe('Method parameter \'year\': Failed to convert value of type \'java.lang.String\' to required type \'int\'; For input string: ""');
  });
});

// Ports apps/api/src/test/java/org/ceitba/api/web/user/MeProfileIT.java.
// savingTheEntityDoesNotOverwriteColumnsWrittenConcurrently holds a JPA
// transaction open: in-process in test/user/me-profile-dynamic-update.test.ts.
// Staff for the file-number corrections is a real ceitba_staff row.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedCareer, seedPlan, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const EMAIL = 'alice@itba.edu.ar';

const as = async (email: string, name = email) => bearer(await mintJwt({ email, name }));
const alice = () => as(EMAIL, 'Alice');
const staff = async () => {
  await seedStaff(api.db, 'staff@itba.edu.ar');
  return as('staff@itba.edu.ar', 'Staff');
};
const patchProfile = async (json: string) => api.patch('/v1/me/profile', { as: await alice(), body: json });
const reload = async () => (await api.db`SELECT * FROM public."user" WHERE email = ${EMAIL}`)[0]!;
const staffPatchFileNumber = async (id: string, json: string, who: Awaited<ReturnType<typeof as>>) =>
  api.patch(`/v1/users/${id}/file-number`, { as: who, body: json });

describe('MeProfileIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public."user", public.plan, public.careers CASCADE`;
    await seedCareer(api.db, 'S', 'Ingeniería en Informática');
    await seedCareer(api.db, 'I', 'Ingeniería Industrial');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'S10-Rev23');
    await seedPlan(api.db, 'S10 - Rev18', 'S', 'S10 - Rev18');
    await seedPlan(api.db, 'I22', 'I', 'I22');
    await seedUser(api.db, EMAIL, { name: 'Alice' });
  });

  test('requiresAuthentication', async () => {
    expect((await api.get('/v1/me/profile')).status).toBe(401);
    expect((await api.patch('/v1/me/profile', { body: '{}' })).status).toBe(401);
  });

  test('setsCareerAndMatchingPlan', async () => {
    const r = await patchProfile('{"careerId":"S","plan":"S10-Rev23"}');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"careerId":"S","plan":"S10-Rev23","fileNumber":null,"linkedin":null,"instagram":null,"discord":null}');
    const g = await api.get('/v1/me/profile', { as: await alice() });
    expect(g.status).toBe(200);
    expect(g.json.careerId).toBe('S');
    expect(g.json.plan).toBe('S10-Rev23');
  });

  test('rejectsPlanOfAnotherCareer', async () => {
    const r = await patchProfile('{"careerId":"S","plan":"I22"}');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'plan' with value 'I22': is not a plan of career 'S'");
    // Nothing was persisted.
    const u = await reload();
    expect(u.career_id).toBeNull();
    expect(u.plan).toBeNull();
  });

  test('rejectsUnknownPlanAndPlanWithoutCareer', async () => {
    const r = await patchProfile('{"plan":"S10-Rev23"}');
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'plan' with value 'S10-Rev23': a plan requires a career");
    expect((await patchProfile('{"careerId":"S","plan":"NOPE"}')).status).toBe(400);
  });

  test('unknownCareerIs404', async () => {
    const r = await patchProfile('{"careerId":"NOPE"}');
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Career with identifier 'NOPE' not found");
  });

  test('planOnlyIsValidatedAgainstCurrentCareer', async () => {
    expect((await patchProfile('{"careerId":"S","plan":"S10-Rev23"}')).status).toBe(200);
    const r = await patchProfile('{"plan":"S10 - Rev18"}');
    expect(r.status).toBe(200);
    expect(r.json.careerId).toBe('S');
    expect(r.json.plan).toBe('S10 - Rev18');
    expect((await patchProfile('{"plan":"I22"}')).status).toBe(400);
  });

  test('careerChangeWithoutPlanClearsPlan', async () => {
    expect((await patchProfile('{"careerId":"S","plan":"S10-Rev23"}')).status).toBe(200);
    const r = await patchProfile('{"careerId":"I"}');
    expect(r.status).toBe(200);
    expect(r.json.careerId).toBe('I');
    expect(r.json.plan).toBeNull();
    expect((await reload()).plan).toBeNull();
  });

  test('sameCareerWithoutPlanKeepsPlan', async () => {
    expect((await patchProfile('{"careerId":"S","plan":"S10-Rev23"}')).status).toBe(200);
    const r = await patchProfile('{"careerId":"S"}');
    expect(r.status).toBe(200);
    expect(r.json.plan).toBe('S10-Rev23');
  });

  test('clearingCareerClearsPlan', async () => {
    expect((await patchProfile('{"careerId":"S","plan":"S10-Rev23"}')).status).toBe(200);
    const r = await patchProfile('{"careerId":""}');
    expect(r.status).toBe(200);
    expect(r.json.careerId).toBeNull();
    expect(r.json.plan).toBeNull();
  });

  test('socialHandlesAreNormalizedFromUrlsAndAtHandles', async () => {
    let r = await patchProfile(`{"linkedin":"https://www.linkedin.com/in/Jane-Doe-123/?trk=x",
                 "instagram":"@Jane.Doe_",
                 "discord":"@Jane_Doe"}`);
    expect(r.status).toBe(200);
    expect(r.json.linkedin).toBe('jane-doe-123');
    expect(r.json.instagram).toBe('jane.doe_');
    expect(r.json.discord).toBe('jane_doe');

    r = await patchProfile('{"instagram":"instagram.com/other.handle/"}');
    expect(r.status).toBe(200);
    expect(r.json.instagram).toBe('other.handle');
    // Untouched fields stay.
    expect(r.json.linkedin).toBe('jane-doe-123');

    const u = await reload();
    expect(u.linkedin).toBe('jane-doe-123');
    expect(u.instagram).toBe('other.handle');
    expect(u.discord).toBe('jane_doe');
  });

  test('socialHandlesCanBeCleared', async () => {
    let r = await patchProfile('{"linkedin":"jane-doe","discord":"Legacy Name#1234"}');
    expect(r.status).toBe(200);
    expect(r.json.discord).toBe('Legacy Name#1234');
    r = await patchProfile('{"linkedin":"","discord":"  "}');
    expect(r.status).toBe(200);
    expect(r.json.linkedin).toBeNull();
    expect(r.json.discord).toBeNull();
  });

  test('invalidSocialHandlesAre400', async () => {
    let r = await patchProfile('{"linkedin":"https://www.linkedin.com/company/acme"}');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'linkedin' with value 'https://www.linkedin.com/company/acme': must be a linkedin.com/in/<handle> URL or a handle");
    expect((await patchProfile('{"instagram":"https://evil.example/instagram.com/x"}')).status).toBe(400);
    expect((await patchProfile(`{"instagram":"${'a'.repeat(31)}"}`)).status).toBe(400);
    expect((await patchProfile('{"discord":"x"}')).status).toBe(400);
    // Bean-validation length cap on the raw input.
    r = await patchProfile(`{"linkedin":"${'a'.repeat(256)}"}`);
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('linkedin: size must be between 0 and 255');
    expect((await reload()).linkedin).toBeNull();
  });

  test('authMeExposesSocialHandles', async () => {
    expect((await patchProfile('{"linkedin":"jane-doe","instagram":"jane","discord":"jane"}')).status).toBe(200);
    const r = await api.get('/v1/auth/me', { as: await alice() });
    expect(r.status).toBe(200);
    expect(r.json.linkedin).toBe('jane-doe');
    expect(r.json.instagram).toBe('jane');
    expect(r.json.discord).toBe('jane');
  });

  // --- fileNumber (legajo): entered once by the user ---

  test('setsFileNumberOnceAndReturnsIt', async () => {
    let r = await patchProfile('{"fileNumber":"61234"}');
    expect(r.status).toBe(200);
    expect(r.json.fileNumber).toBe(61234);
    expect((await api.get('/v1/me/profile', { as: await alice() })).json.fileNumber).toBe(61234);
    expect((await reload()).file_number).toBe(61234);

    // A retry with the same number is a no-op, not an error.
    r = await patchProfile('{"fileNumber":"61234","instagram":"alice"}');
    expect(r.status).toBe(200);
    expect(r.json.fileNumber).toBe(61234);
    expect(r.json.instagram).toBe('alice');
  });

  test('secondDifferentFileNumberIs409AndSavesNothing', async () => {
    expect((await patchProfile('{"fileNumber":61234}')).status).toBe(200);
    const r = await patchProfile('{"fileNumber":"61235","careerId":"S"}');
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('FileNumberAlreadySet');
    expect(r.json.message).toBe('The file number is already set; ask CEITBA staff to change it.');
    const u = await reload();
    expect(u.file_number).toBe(61234);
    expect(u.career_id).toBeNull();
  });

  test('fileNumberCannotBeClearedByTheUser', async () => {
    expect((await patchProfile('{"fileNumber":"61234"}')).status).toBe(200);
    expect((await patchProfile('{"fileNumber":""}')).status).toBe(400);
    // Omitting it (or null) leaves it alone.
    const r = await patchProfile('{"fileNumber":null,"careerId":"S"}');
    expect(r.status).toBe(200);
    expect(r.json.fileNumber).toBe(61234);
  });

  test('fileNumberTakenByAnotherUserIs409', async () => {
    await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob', fileNumber: 61234 });
    const r = await patchProfile('{"fileNumber":"61234"}');
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('FileNumberTaken');
    expect(r.json.message).toBe('That file number is already registered to another account.');
    expect((await reload()).file_number).toBeNull();
  });

  test('invalidFileNumberIs400', async () => {
    for (const bad of ['"abc"', '"6123"', '"1234567"', '"06123"', '"61 234"', '"-6123"', '-61234', '61234.5', '""']) {
      const r = await patchProfile(`{"fileNumber":${bad}}`);
      expect(r.status).toBe(400);
    }
    const r = await patchProfile('{"fileNumber":"abc"}');
    expect(r.json.message).toBe('fileNumber: must be the legajo: 5 or 6 digits, no leading zero');
    expect((await reload()).file_number).toBeNull();
    // 6 digits are accepted (room for growth).
    expect((await patchProfile('{"fileNumber":"100001"}')).status).toBe(200);
  });

  test('staffCanStillChangeOrClearTheFileNumber', async () => {
    expect((await patchProfile('{"fileNumber":"61234"}')).status).toBe(200);
    const id = (await reload()).id as string;
    await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob', fileNumber: 60000 });

    // Plain users cannot use the staff path.
    expect((await staffPatchFileNumber(id, '{"file_number":61235}', await as(EMAIL))).status).toBe(403);

    const s = await staff();
    let r = await staffPatchFileNumber(id, '{"file_number":61235}', s);
    expect(r.status).toBe(200);
    expect(r.json.file_number).toBe(61235);
    expect((await api.get('/v1/me/profile', { as: await alice() })).json.fileNumber).toBe(61235);

    r = await staffPatchFileNumber(id, '{"file_number":60000}', s);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('FileNumberTaken');
    r = await staffPatchFileNumber(id, '{"file_number":-1}', s);
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('fileNumber: must be greater than 0');
    expect((await staffPatchFileNumber(crypto.randomUUID(), '{"file_number":61236}', s)).status).toBe(404);

    // Cleared by staff: the user can enter it again.
    r = await staffPatchFileNumber(id, '{"file_number":null}', s);
    expect(r.status).toBe(200);
    expect(r.json.file_number).toBeNull();
    r = await patchProfile('{"fileNumber":"61236"}');
    expect(r.status).toBe(200);
    expect(r.json.fileNumber).toBe(61236);
  });

  test('concurrentClaimsOfOneNumberByTwoUsersLetExactlyOneWin', async () => {
    await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    const [a, b] = await Promise.all([
      patchProfile('{"fileNumber":"61234"}'),
      (async () => api.patch('/v1/me/profile', { as: await as('bob@itba.edu.ar'), body: '{"fileNumber":"61234"}' }))(),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public."user" WHERE file_number = 61234` as unknown as [{ n: number }];
    expect(n).toBe(1);
  });

  test('concurrentClaimsOfTwoNumbersByOneUserLetExactlyOneWin', async () => {
    const [a, b] = await Promise.all([patchProfile('{"fileNumber":"61234"}'), patchProfile('{"fileNumber":"61235"}')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([61234, 61235]).toContain((await reload()).file_number);
  });
});

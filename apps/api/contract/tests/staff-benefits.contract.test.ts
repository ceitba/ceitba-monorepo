// Ports apps/api/src/test/java/org/ceitba/api/web/staff/BenefitControllerIT.java
// and BenefitCardControllerIT.java. STAFF is a real ceitba_staff row.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, useServer, type As } from '../support';

const api = useServer();
let staff: As;
let user: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
  user = bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));
});

const seedBenefit = async (slug: string, colorVar: string, order: number, nameEs: string | null = null, nameEn: string | null = null) =>
  api.db`INSERT INTO public.benefits (slug, color_var, display_order, name_es, name_en) VALUES (${slug}, ${colorVar}, ${order}, ${nameEs}, ${nameEn})`;
const benefitCount = async () => Number((await api.db`SELECT count(*)::int AS n FROM public.benefits`)[0]!.n);
const cardCount = async () => Number((await api.db`SELECT count(*)::int AS n FROM public.benefit_cards`)[0]!.n);

describe('BenefitControllerIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.benefit_cards`;
    await api.db`DELETE FROM public.benefits`;
    await seedBenefit('deportes', '--dept-color-deportes', 1, 'Deportes', 'Sports');
    await seedBenefit('academico', '--dept-color-infra', 0);
  });

  test('publicListIsOrderedAndIncludesNames', async () => {
    const r = await api.get('/v1/benefits');
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"slug":"academico","colorVar":"--dept-color-infra","displayOrder":0,"linkUrl":null,"contactEmail":null,"highlightsEs":[],"highlightsEn":[],"nameEs":null,"nameEn":null},'
      + '{"slug":"deportes","colorVar":"--dept-color-deportes","displayOrder":1,"linkUrl":null,"contactEmail":null,"highlightsEs":[],"highlightsEn":[],"nameEs":"Deportes","nameEn":"Sports"}]');
  });

  test('writesRequireStaff', async () => {
    const body = { colorVar: '--x', displayOrder: 6, nameEs: 'Convenios', nameEn: 'Partnerships' };
    expect((await api.post('/v1/benefits/convenios', { body })).status).toBe(401);
    expect((await api.post('/v1/benefits/convenios', { as: user, body })).status).toBe(403);
    expect((await api.put('/v1/benefits/deportes', { as: user, body })).status).toBe(403);
    expect((await api.delete('/v1/benefits/deportes', { as: user })).status).toBe(403);
    expect((await api.db`SELECT 1 FROM public.benefits WHERE slug = 'convenios'`).length).toBe(0);
  });

  test('staffCreatesCategoryWithNames', async () => {
    const body = { colorVar: '--dept-color-media', displayOrder: 6, nameEs: 'Convenios', nameEn: 'Partnerships' };
    let r = await api.post('/v1/benefits/convenios', { as: staff, body });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"slug":"convenios","colorVar":"--dept-color-media","displayOrder":6,"linkUrl":null,"contactEmail":null,"highlightsEs":[],"highlightsEn":[],"nameEs":"Convenios","nameEn":"Partnerships"}');
    r = await api.post('/v1/benefits/convenios', { as: staff, body });
    expect(r.status).toBe(409);
  });

  test('createRejectsInvalidSlugs', async () => {
    const body = { colorVar: '--dept-color-media', displayOrder: 6, nameEs: 'Convenios' };
    for (const slug of ['Convenios', 'a', 'con--venios', '-convenios', 'convenios-', 'con_venios', 'x'.repeat(41)]) {
      const r = await api.post(`/v1/benefits/${slug}`, { as: staff, body });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('InvalidSlug');
      expect(r.json.message).toBe(`Validation failed for field 'slug' with value '${slug}': must be 2-40 lowercase letters, digits or single hyphens`);
    }
    expect(await benefitCount()).toBe(2);
  });

  test('createDuplicateOfSeededSlugIs409', async () => {
    const r = await api.post('/v1/benefits/deportes', { as: staff, body: '{"colorVar":"--dept-color-it","displayOrder":9,"nameEs":"Otro"}' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
    expect((await api.db`SELECT name_es FROM public.benefits WHERE slug = 'deportes'`)[0]!.name_es).toBe('Deportes');
  });

  test('createdCategoryAppearsInPublicList', async () => {
    const r = await api.post('/v1/benefits/idiomas-2', { as: staff, body: '{"colorVar":"--dept-color-direct","displayOrder":2,"nameEs":"Idiomas"}' });
    expect(r.status).toBe(201);
    expect(r.json.slug).toBe('idiomas-2');
    expect(r.json.colorVar).toBe('--dept-color-direct');
    expect(r.json.displayOrder).toBe(2);
    expect(r.json.nameEn).toBeNull();
    expect((await api.get('/v1/benefits')).json.map((b: { slug: string }) => b.slug)).toEqual(['academico', 'deportes', 'idiomas-2']);
  });

  test('updateWithoutNamesKeepsThemAndBlankClears', async () => {
    let r = await api.put('/v1/benefits/deportes', { as: staff, body: '{"colorVar":"--dept-color-deportes","displayOrder":3,"highlightsEs":["Gimnasio"]}' });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"slug":"deportes","colorVar":"--dept-color-deportes","displayOrder":3,"linkUrl":null,"contactEmail":null,"highlightsEs":["Gimnasio"],"highlightsEn":[],"nameEs":"Deportes","nameEn":"Sports"}');
    r = await api.put('/v1/benefits/deportes', { as: staff, body: '{"colorVar":"--dept-color-deportes","displayOrder":3,"nameEs":"Deportes y más","nameEn":""}' });
    expect(r.status).toBe(200);
    expect(r.json.nameEs).toBe('Deportes y más');
    expect(r.json.nameEn).toBeNull();
    // highlights are replaced (absent = empty).
    expect(r.json.highlightsEs).toEqual([]);
  });

  test('staffDeletesAndUnknownIs404', async () => {
    expect((await api.delete('/v1/benefits/academico', { as: staff })).status).toBe(204);
    const r = await api.delete('/v1/benefits/academico', { as: staff });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Benefit with identifier 'academico' not found");
    expect((await api.put('/v1/benefits/nope', { as: staff, body: '{"colorVar":"--x","displayOrder":0}' })).status).toBe(404);
  });
});

const FULL_BODY = `{"categorySlug":"convenios","displayOrder":1,"titleEs":"Gimnasio X","titleEn":"Gym X",
         "summaryEs":"Descuento","bulletsEs":["20% off"," ","Pase libre"],
         "ctaUrl":"https://gym.example/inscripcion",
         "location":"Av. Madero 399","locationUrl":"https://maps.example/?q=madero",
         "phone":"+54 11 1234-5678","website":"https://gym.example","email":"hola@gym.example"}`;

describe('BenefitCardControllerIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.benefit_cards`;
    await api.db`DELETE FROM public.benefits`;
    await seedBenefit('convenios', '--dept-color-media', 1);
    await seedBenefit('idiomas', '--dept-color-infra', 2);
  });

  const seedCard = async (category: string, titleEs: string, titleEn: string, order = 0) => {
    const [r] = await api.db`INSERT INTO public.benefit_cards (category_slug, display_order, title_es, title_en) VALUES (${category}, ${order}, ${titleEs}, ${titleEn}) RETURNING id`;
    return r!.id as string;
  };
  const createFull = async () => {
    const r = await api.post('/v1/benefit-cards', { as: staff, body: FULL_BODY });
    expect(r.status).toBe(201);
    return r;
  };

  test('publicListIsOrdered', async () => {
    await seedCard('idiomas', 'B inglés', 'B english', 2);
    await seedCard('convenios', 'A gym', 'A gym', 1);
    const r = await api.get('/v1/benefit-cards');
    expect(r.status).toBe(200);
    expect(r.json.map((c: { titleEs: string }) => c.titleEs)).toEqual(['A gym', 'B inglés']);
    expect(r.json[0].phone).toBeNull();
  });

  test('staffCreatesCardWithContactFields', async () => {
    const c = await createFull();
    // Blank bullets dropped, null summaryEn stored as "", blank-to-null on the optional strings.
    expect(c.text).toBe(`{"id":"${c.json.id}","categorySlug":"convenios","displayOrder":1,"titleEs":"Gimnasio X","titleEn":"Gym X","summaryEs":"Descuento","summaryEn":"",`
      + '"imageUrl":null,"ctaUrl":"https://gym.example/inscripcion","ctaLabelEs":null,"ctaLabelEn":null,"price":null,"bulletsEs":["20% off","Pase libre"],"bulletsEn":[],'
      + '"location":"Av. Madero 399","locationUrl":"https://maps.example/?q=madero","phone":"+54 11 1234-5678","website":"https://gym.example","email":"hola@gym.example"}');
    const r = await api.get('/v1/benefit-cards');
    expect(r.json.length).toBe(1);
    expect(r.json[0].categorySlug).toBe('convenios');
    expect(r.json[0].bulletsEs).toEqual(['20% off', 'Pase libre']);
    expect(r.json[0].ctaUrl).toBe('https://gym.example/inscripcion');
    expect(r.json[0].location).toBe('Av. Madero 399');
    expect(r.json[0].locationUrl).toBe('https://maps.example/?q=madero');
    expect(r.json[0].phone).toBe('+54 11 1234-5678');
    expect(r.json[0].website).toBe('https://gym.example');
    expect(r.json[0].email).toBe('hola@gym.example');
  });

  test('writesRequireStaff', async () => {
    const id = await seedCard('convenios', 'x', 'x');
    expect((await api.post('/v1/benefit-cards', { body: FULL_BODY })).status).toBe(401);
    expect((await api.post('/v1/benefit-cards', { as: user, body: FULL_BODY })).status).toBe(403);
    expect((await api.put(`/v1/benefit-cards/${id}`, { as: user, body: FULL_BODY })).status).toBe(403);
    expect((await api.delete(`/v1/benefit-cards/${id}`, { as: user })).status).toBe(403);
    expect(await cardCount()).toBe(1);
  });

  test('updateWithoutContactFieldsKeepsThemAndBlankClears', async () => {
    const id = (await createFull()).json.id as string;
    let r = await api.put(`/v1/benefit-cards/${id}`, { as: staff, body: '{"categorySlug":"idiomas","displayOrder":4,"titleEs":"Inglés","titleEn":"English"}' });
    expect(r.status).toBe(200);
    expect(r.json.categorySlug).toBe('idiomas');
    expect(r.json.titleEs).toBe('Inglés');
    expect(r.json.phone).toBe('+54 11 1234-5678');
    expect(r.json.email).toBe('hola@gym.example');
    // Fields outside the contact group are replaced.
    expect(r.json.summaryEs).toBe('');
    expect(r.json.bulletsEs).toEqual([]);

    r = await api.put(`/v1/benefit-cards/${id}`, { as: staff, body: `{"categorySlug":"idiomas","displayOrder":4,"titleEs":"Inglés","titleEn":"English",
                     "phone":"","email":"","website":"https://new.example","locationUrl":""}` });
    expect(r.status).toBe(200);
    expect(r.json.phone).toBeNull();
    expect(r.json.email).toBeNull();
    expect(r.json.website).toBe('https://new.example');
    expect(r.json.location).toBe('Av. Madero 399');
    expect(r.json.locationUrl).toBeNull();

    r = await api.put(`/v1/benefit-cards/${id}`, { as: staff, body: '{"categorySlug":"idiomas","displayOrder":4,"titleEs":"Inglés","titleEn":"English","website":"gym.example"}' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('website: must be an http(s) URL');
  });

  test('invalidRequestsAreRejected', async () => {
    let r = await api.post('/v1/benefit-cards', { as: staff, body: FULL_BODY.replace('hola@gym.example', 'not-an-email') });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('email: must be a well-formed email address');
    r = await api.post('/v1/benefit-cards', { as: staff, body: FULL_BODY.replace('+54 11 1234-5678', '9'.repeat(65)) });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('phone: size must be between 0 and 64');
    expect((await api.post('/v1/benefit-cards', { as: staff, body: FULL_BODY.replace('https://gym.example","email', 'javascript:alert(1)","email') })).status).toBe(400);
    expect((await api.post('/v1/benefit-cards', { as: staff, body: FULL_BODY.replace('https://maps.example/?q=madero', 'intent://maps#Intent;end') })).status).toBe(400);
    r = await api.post('/v1/benefit-cards', { as: staff, body: FULL_BODY.replace('"convenios"', '"nope"') });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Benefit with identifier 'nope' not found");
    expect(await cardCount()).toBe(0);
  });

  test('staffDeletesAndUnknownIs404', async () => {
    const id = (await createFull()).json.id as string;
    expect((await api.delete(`/v1/benefit-cards/${id}`, { as: staff })).status).toBe(204);
    const r = await api.delete(`/v1/benefit-cards/${id}`, { as: staff });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`BenefitCard with identifier '${id}' not found`);
    expect((await api.put(`/v1/benefit-cards/${crypto.randomUUID()}`, { as: staff, body: FULL_BODY })).status).toBe(404);
  });
});

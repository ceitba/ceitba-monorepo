// Ports apps/api/src/test/java/org/ceitba/api/web/capability/PublicCapabilitiesIT.java.
// GET /v1/capabilities: anonymous visitors learn which features are on for everyone.
import { afterEach, describe, expect, test } from 'bun:test';
import { useServer } from '../support';

const api = useServer();

describe('PublicCapabilitiesIT', () => {
  afterEach(async () => {
    await api.db`DELETE FROM public.capability_settings`;
  });

  test('listsOnlyCapabilitiesEnabledForAllWithoutASession', async () => {
    await api.db`DELETE FROM public.capability_settings`;
    let r = await api.get('/v1/capabilities');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"enabledForAll":[]}');

    await api.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES
                 ('apuntes', true), ('resumen_semanal', false), ('gone', true)`;
    r = await api.get('/v1/capabilities');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"enabledForAll":["apuntes"]}');
  });
});

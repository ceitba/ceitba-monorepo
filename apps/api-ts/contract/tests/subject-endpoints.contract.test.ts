// Ports apps/api/src/test/java/org/ceitba/api/web/subject/SubjectEndpointsIT.java.
import { beforeEach, describe, expect, test } from 'bun:test';
import { useServer } from '../support';

const api = useServer();

describe('SubjectEndpointsIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.subject`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Algoritmos y Estructuras de Datos', 6, now())`;
  });

  test('getSubjectByIdReturnsTheOne', async () => {
    const r = await api.get('/v1/subjects/93.12');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"id":"93.12","name":"Algoritmos y Estructuras de Datos","credits":6}');
  });

  test('getUnknownSubjectReturns404', async () => {
    const r = await api.get('/v1/subjects/99.99');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
    expect(r.json.message).toBe("Subject with identifier '99.99' not found");
  });
});

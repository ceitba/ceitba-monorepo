// In-process port of the exact-instant boundaries of HighlightsIT
// (apps/api/src/test/java/org/ceitba/api/web/highlight/HighlightsIT.java,
// publicListShowsOnlyActiveInsideWindowOrderedByPosition): with the clock at
// NOW, a highlight ending at NOW is gone and one starting at NOW is shown.
// The rest of the IT is black-box: contract/tests/highlight-highlights.contract.test.ts.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MutableClock } from '../../src/infra/clock';
import { testApp, type TestApp } from '../support/app';

const NOW = Date.parse('2026-09-21T15:00:00Z');
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
let t: TestApp;
beforeAll(async () => { t = await testApp({ overrides: { clock: new MutableClock(NOW * 1000) } }); }, 60_000);
afterAll(async () => { await t?.close(); });

test('publicListShowsOnlyActiveInsideWindowOrderedByPosition', async () => {
  let seq = 0;
  const save = async (title: string, position: number, starts: string | null, ends: string | null, active: boolean) => {
    seq++;
    await t.sql`INSERT INTO public.home_highlights (title, image_url, position, starts_at, ends_at, active, created_at, updated_at)
      VALUES (${title}, ${`https://img.example/${title}.png`}, ${position}, ${starts}, ${ends}, ${active}, now() + make_interval(secs => ${seq} / 1000.0), now())`;
  };
  await save('third', 3, null, null, true);
  await save('first', 1, at(-1), at(1), true);
  await save('second', 2, null, at(24), true);
  await save('inactive', 0, null, null, false);
  await save('expired', 0, null, at(-1), true);
  await save('endsNow', 0, null, at(0), true);
  await save('scheduled', 0, at(1), null, true);
  await save('startsNow', 4, at(0), null, true);
  const r = await t.request('GET', '/v1/highlights');
  expect(r.status).toBe(200);
  expect(r.json.map((h: { title: string }) => h.title)).toEqual(['first', 'second', 'third', 'startsNow']);
  expect(r.json[0].imageUrl).toBe('https://img.example/first.png');
  expect(r.json[0].active).toBe(true);
});

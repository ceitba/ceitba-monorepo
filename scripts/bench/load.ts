#!/usr/bin/env bun
// Load test of the API's hot read routes (docs/plans/api-bun-rewrite.md phase 5:
// "Load test the 10 hottest routes; p95 must not regress against Java").
// Results and the exact setup are in docs/plans/api-bun-baseline.md "Load test".
//
//   bun scripts/bench/load.ts seed > seed.sql
//       SQL that seeds a migrated, empty database with realistic volume
//       (plans, ~1k subjects, ~6k commissions, 50 orgs, 2k articles, 1k events,
//       5k users, saved schedules, 2.2k wiki pages with 8.8k 768-d chunks, 3k
//       drive files) plus the benchmark user. Deterministic except the random
//       embedding vectors; seed once and clone the database per server.
//
//   bun scripts/bench/load.ts run --base http://host:8080 --label java --out java.json
//       [--warmup 10] [--duration 30] [--concurrency 32] [--routes a,b] [--prime 0]
//       Preflight (every route once: must be 200 with a non-empty body, aborts
//       otherwise), then per route: closed loop of N keep-alive workers, a
//       warm-up whose samples are discarded, a measured window. Writes
//       p50/p95/p99/max (ms), req/s, error count and response size per route.
//       --prime S first runs S seconds over all routes round-robin (JIT warm-up).
//       The session cookie is an HS256 JWT minted like the contract harness
//       (contract/support/identity.ts) with BENCH_JWT_SECRET, which must equal
//       the servers' AUTH_JWT_SECRET (the runs used contract/support/env.ts's
//       TEST_JWT_SECRET), iss https://ceitba.org.ar/api, aud ceitba-api.
//
//   bun scripts/bench/load.ts compare java.json bun.json
//       Markdown table, Java vs Bun, with the p95 verdict per route.

import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const BENCH_USER_ID = '00000000-0000-4000-8000-00000000b001';
const BENCH_EMAIL = 'bench@itba.edu.ar';
const HOT_PLAN = 'BP-S-1';

// ------------------------------------------------------------------ seed

const SEED_SQL = String.raw`
-- Load-test seed (scripts/bench/load.ts seed). Run on a freshly migrated DB.
BEGIN;
SELECT setseed(0.42);

-- 50 organizations (15 come from the migrations).
INSERT INTO organizations (slug, name, full_name, description, category, color)
SELECT 'bench-org-' || n, 'Org ' || n, 'Organización de prueba ' || n,
       repeat('Descripción de la organización ' || n || '. ', 6),
       (ARRAY['Tech','Culture','Business','Community','Engineering'])[1 + n % 5], '#3366' || lpad(to_hex(n * 4), 2, '0')
FROM generate_series(1, 35) n;

-- Plans: two per career (38) on top of the migrations' plans.
INSERT INTO plan (id, career_id, name, updated_at)
SELECT 'BP-' || c.id || '-' || k, c.id, 'Plan ' || c.id || ' ' || k, now()
FROM careers c, generate_series(1, 2) k;

-- 1,000 subjects.
INSERT INTO subject (id, name, credits, updated_at)
SELECT 'B' || lpad(n::text, 4, '0'), 'Materia de prueba número ' || n, 3 + n % 6, now()
FROM generate_series(1, 1000) n;

-- 64 subjects per bench plan (2,432 plan_subject rows), with prerequisites.
INSERT INTO plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies)
SELECT 'B' || lpad((((p.rn * 37 + k) % 1000) + 1)::text, 4, '0'), p.id,
       CASE WHEN k < 52 THEN 'Materias Obligatorias' ELSE 'Electivas' END,
       CASE WHEN k < 52 THEN 1 + k / 10 ELSE 0 END, CASE WHEN k < 52 THEN 1 + (k / 5) % 2 ELSE 0 END,
       CASE WHEN k < 52 THEN 0 ELSE 60 END,
       CASE WHEN k >= 10 AND k < 52 THEN ARRAY['B' || lpad((((p.rn * 37 + k - 10) % 1000) + 1)::text, 4, '0')]::varchar[] ELSE ARRAY[]::varchar[] END
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM plan WHERE id LIKE 'BP-%') p, generate_series(0, 63) k;

-- Commissions: 4 in the current term + 2 in the previous term per subject (6,000),
-- two weekly slots each (12,000 slots).
INSERT INTO commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type, term_year, term_period)
SELECT 'B' || lpad(n::text, 4, '0') || '-' || c.name, 'B' || lpad(n::text, 4, '0'), c.name,
       CASE WHEN c.past THEN CURRENT_DATE - 300 ELSE CURRENT_DATE - 45 END,
       CASE WHEN c.past THEN CURRENT_DATE - 180 ELSE CURRENT_DATE + 75 END,
       20 + (n * 7 + ascii(c.name)) % 40, 60, 'SEMESTRAL',
       extract(year FROM CURRENT_DATE)::smallint, CASE WHEN c.past THEN 'FIRST' ELSE 'SECOND' END
FROM generate_series(1, 1000) n,
     (VALUES ('A', false), ('B', false), ('C', false), ('D', false), ('PA', true), ('PB', true)) AS c(name, past);

INSERT INTO commission_time (course_id, day, classroom, building, hour_from, hour_to)
SELECT c.id, (ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY']::day_of_week[])[1 + (h + s.k * 2) % 5],
       (100 + (h % 4) * 100 + (h / 4) % 20)::text, (ARRAY['SDF','SDT','PP'])[1 + h % 3],
       make_time(8 + (h + s.k) % 12, CASE WHEN h % 2 = 0 THEN 0 ELSE 30 END, 0),
       make_time(8 + (h + s.k) % 12 + 2, CASE WHEN h % 2 = 0 THEN 0 ELSE 30 END, 0)
FROM (SELECT id, abs(hashtext(id)) AS h FROM commission WHERE id LIKE 'B%') c, (VALUES (0), (1)) s(k);

-- 5,000 users (+ the bench user) with careers and plans.
INSERT INTO "user" (id, email, name, career_id, plan, file_number, created_at, updated_at, preferred_language)
SELECT ('00000000-0000-4000-9000-' || lpad(to_hex(n), 12, '0'))::uuid, 'bench' || n || '@itba.edu.ar', 'Usuario ' || n,
       'S', 'BP-S-' || (1 + n % 2), 100000 + n, now() - (n || ' hours')::interval, now(), 'es'
FROM generate_series(1, 5000) n;
INSERT INTO "user" (id, email, name, career_id, plan, file_number, created_at, updated_at, preferred_language)
VALUES ('${BENCH_USER_ID}', '${BENCH_EMAIL}', 'Bench User', 'S', '${HOT_PLAN}', 99999, now(), now(), 'es');
INSERT INTO capability_user_grants (capability, email) VALUES ('apuntes', '${BENCH_EMAIL}');

-- Follows (3 per user), some org members.
INSERT INTO user_follows (user_id, org_slug, created_at)
SELECT u.id, o.slug, now()
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM "user") u
JOIN (SELECT slug, row_number() OVER (ORDER BY slug) - 1 AS rn FROM organizations) o
  ON o.rn IN (u.rn % 50, (u.rn * 7) % 50, (u.rn * 13 + 1) % 50)
ON CONFLICT DO NOTHING;
INSERT INTO user_organizations (user_id, org_slug, role, created_at)
SELECT ('00000000-0000-4000-9000-' || lpad(to_hex(n), 12, '0'))::uuid, 'bench-org-' || (1 + n % 35), CASE WHEN n % 5 = 0 THEN 'admin' ELSE 'member' END, now()
FROM generate_series(1, 300) n;

-- 2,000 articles (95% published) with votes.
INSERT INTO articles (id, title, excerpt, body, category, organization, published_at, reading_time, featured, color_scheme, status, authors, created_at, updated_at)
SELECT 'bench-art-' || lpad(n::text, 4, '0'), 'Artículo de prueba ' || n || ': novedades del centro de estudiantes',
       'Resumen del artículo ' || n || ', con lo más importante en dos líneas para la portada del newsletter.',
       jsonb_build_array(E'## Sección uno\n\n' || repeat('Texto del artículo ' || n || '. ', 40),
                         E'### Sección dos\n\n' || repeat('Más contenido con **negritas** y [links](https://ceitba.org.ar). ', 30),
                         E'- punto uno\n- punto dos\n- punto tres'),
       (ARRAY['Académico','Tecnología','Deportes','Cultura','Organizaciones','General'])[1 + n % 6],
       CASE WHEN n % 10 = 0 THEN NULL ELSE (SELECT slug FROM organizations ORDER BY slug OFFSET (n % 50) LIMIT 1) END,
       CURRENT_DATE - (n % 700), (2 + n % 8) || ' min', false, 'blue',
       CASE WHEN n % 20 = 0 THEN 'draft' ELSE 'published' END, '["CEITBA"]'::jsonb,
       now() - (n || ' hours')::interval, now()
FROM generate_series(1, 2000) n;
INSERT INTO article_votes (article_id, up_count, down_count)
SELECT id, abs(hashtext(id)) % 200, abs(hashtext(id || 'd')) % 20 FROM articles WHERE id LIKE 'bench-art-%';
INSERT INTO vote_records (article_id, fingerprint, vote_type)
SELECT 'bench-art-' || lpad((1 + n % 2000)::text, 4, '0'), md5(n::text), CASE WHEN n % 9 = 0 THEN 'down' ELSE 'up' END
FROM generate_series(1, 20000) n;

-- 1,000 events from a year ago to six months ahead, with RSVPs.
INSERT INTO news_events (id, title, event_date, start_time, end_time, location, category, organization, description, signup_mode, capacity, created_at)
SELECT 'bench-evt-' || lpad(n::text, 4, '0'), 'Evento de prueba ' || n, CURRENT_DATE - 365 + (n * 547 / 1000),
       make_time(9 + n % 10, 0, 0), make_time(11 + n % 10, 0, 0), 'Aula ' || (100 + n % 300),
       (ARRAY['Académico','Tecnología','Deportes','Cultura','Organizaciones','General'])[1 + n % 6],
       (SELECT slug FROM organizations ORDER BY slug OFFSET (n % 50) LIMIT 1),
       repeat('Descripción del evento ' || n || '. ', 10), CASE WHEN n % 3 = 0 THEN 'rsvp' ELSE 'none' END,
       CASE WHEN n % 3 = 0 THEN 100 ELSE NULL END, now()
FROM generate_series(1, 1000) n;
INSERT INTO event_rsvps (event_id, user_id, created_at)
SELECT 'bench-evt-' || lpad((3 * (1 + n % 333))::text, 4, '0'), ('00000000-0000-4000-9000-' || lpad(to_hex(n), 12, '0'))::uuid, now()
FROM generate_series(1, 5000) n;

-- Saved schedules: 2 per user for 2,000 users, 5 for the bench user (~2 KB payloads).
INSERT INTO saved_schedules (user_id, name, career_id, plan, payload, is_primary)
SELECT u.id, 'Horario ' || k, 'S', u.plan,
       jsonb_build_object('version', 2, 'planId', u.plan,
         'subjects', (SELECT jsonb_agg(jsonb_build_object('code', 'B' || lpad((((u.n + j) % 1000) + 1)::text, 4, '0'),
                                                           'commission', 'A', 'color', '#a0c4ff', 'locked', j % 2 = 0))
                      FROM generate_series(0, 6) j),
         'blockedTimes', jsonb_build_array(jsonb_build_object('day', 'MONDAY', 'from', '08:00', 'to', '10:00')),
         'options', jsonb_build_object('avoidGaps', true, 'maxDays', 4, 'notes', repeat('nota ', 40))),
       k = 1
FROM (SELECT id, plan, row_number() OVER (ORDER BY id) AS n FROM "user") u, generate_series(1, 5) k
WHERE (u.n <= 2000 AND k <= 2) OR u.id = '${BENCH_USER_ID}';

-- Drive: one community source, 3,000 published files over the first 300 subjects.
INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, kind, display_name)
VALUES ('00000000-0000-4000-a000-000000000001', NULL, 'bench-root', 'Apuntes comunitarios', 'ACTIVE', 'v1', now(), 'COMMUNITY_ROOT', 'Comunidad');
INSERT INTO wiki.drive_file (source_id, drive_id, name, mime_type, kind, subject_id, effective_subject_id, publication, published_at,
                             size_bytes, drive_modified_at, text_content, academic_year)
SELECT '00000000-0000-4000-a000-000000000001', 'bench-df-' || n, 'Apunte ' || n || '.pdf', 'application/pdf', 'PDF',
       'B' || lpad((1 + n % 300)::text, 4, '0'), 'B' || lpad((1 + n % 300)::text, 4, '0'), 'PUBLISHED', now() - (n || ' hours')::interval,
       100000 + n, now() - (n || ' hours')::interval, repeat('contenido del apunte ' || n || ' ', 20), 2020 + n % 6
FROM generate_series(1, 3000) n;

-- Subject wikis for the first 200 subjects: an index + 10 topics each (2,200 pages),
-- links between consecutive topics, 4 chunks per page with random 768-d vectors (8,800).
INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, sources, generator, generated_at)
SELECT 'B' || lpad(s::text, 4, '0'), CASE WHEN t = 0 THEN 'index' ELSE 'tema-' || lpad(t::text, 2, '0') END,
       CASE WHEN t = 0 THEN 'INDEX' ELSE 'TOPIC' END,
       CASE WHEN t = 0 THEN 'Materia ' || s ELSE 'Tema ' || t || ' de la materia ' || s END,
       'Resumen del tema ' || t || ' de la materia ' || s || '.',
       '# Tema ' || t || E'\n\n' || repeat('Explicación del concepto con fórmulas, ejemplos y ejercicios resueltos. ', 50)
         || E'\n\n## Ejemplo\n\n' || repeat('Paso a paso del ejemplo. ', 30)
         || CASE WHEN t BETWEEN 1 AND 9 THEN E'\n\nVer también [[tema-' || lpad((t + 1)::text, 2, '0') || ']].' ELSE '' END,
       ARRAY(SELECT id FROM wiki.drive_file WHERE drive_id IN ('bench-df-' || s, 'bench-df-' || (s + 300))),
       'bench', now()
FROM generate_series(1, 200) s, generate_series(0, 10) t;
INSERT INTO wiki.kb_link (from_page_id, raw, to_subject_id, to_slug, to_page_id)
SELECT p.id, 'tema-' || lpad((substring(p.slug FROM 6)::int + 1)::text, 2, '0'), p.subject_id,
       'tema-' || lpad((substring(p.slug FROM 6)::int + 1)::text, 2, '0'), q.id
FROM wiki.kb_page p JOIN wiki.kb_page q ON q.subject_id = p.subject_id
 AND q.slug = 'tema-' || lpad((substring(p.slug FROM 6)::int + 1)::text, 2, '0')
WHERE p.slug LIKE 'tema-%';
INSERT INTO wiki.kb_page_chunk (page_id, page_revision, ordinal, heading, anchor, content, model, embedding)
SELECT p.id, p.revision, o, 'Sección ' || o, 'seccion-' || o,
       p.title || ': ' || repeat('fragmento de texto indexado para la búsqueda semántica ', 12),
       'embeddinggemma-2',
       (SELECT array_agg(random() - 0.5)::vector FROM generate_series(1, 768) g WHERE g > o * 0 AND p.revision > 0)
FROM wiki.kb_page p, generate_series(0, 3) o;

COMMIT;
ANALYZE;
`;

// ------------------------------------------------------------------ routes

interface Route { name: string; path: (i: number) => string; auth?: boolean }

const ROUTES: Route[] = [
  { name: 'careers', path: () => '/api/v1/careers' },
  { name: 'plan-subjects', path: () => `/api/v1/plans/${HOT_PLAN}/subjects` },
  { name: 'plan-commissions', path: () => `/api/v1/commissions?plan=${HOT_PLAN}` },
  { name: 'articles-list', path: (i) => `/api/v1/articles?page=${1 + (i % 5)}&limit=20` },
  { name: 'article', path: (i) => { const n = 1 + ((i * 7) % 2000); return `/api/v1/articles/bench-art-${String(n % 20 === 0 ? n - 1 : n).padStart(4, '0')}`; } },
  { name: 'events-list', path: () => '/api/v1/news/events?page=1&limit=50' },
  { name: 'organizations', path: () => '/api/v1/organizations' },
  { name: 'auth-me', path: () => '/api/v1/auth/me', auth: true },
  { name: 'my-schedules', path: () => '/api/v1/me/schedules', auth: true },
  { name: 'classrooms-availability', path: () => '/api/v1/classrooms/availability?day=MONDAY&at=10:00' },
  { name: 'kb-page', path: (i) => `/api/v1/wiki/subjects/B${String(1 + (i % 200)).padStart(4, '0')}/kb/tema-${String(1 + (i % 10)).padStart(2, '0')}`, auth: true },
  { name: 'kb-search', path: (i) => `/api/v1/wiki/kb/search?q=${encodeURIComponent(['derivadas parciales', 'integrales dobles', 'teorema fundamental', 'matrices y determinantes', 'ejercicios resueltos'][i % 5]!)}`, auth: true },
];

function mintJwt(secretB64: string): string {
  const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256' }));
  const payload = b64u(JSON.stringify({
    iss: 'https://ceitba.org.ar/api', aud: 'ceitba-api', jti: crypto.randomUUID(), sub: BENCH_USER_ID,
    email: BENCH_EMAIL, name: 'Bench User', iat: now, exp: now + 6 * 3600,
  }));
  const sig = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

interface Result {
  route: string; samples: number; errors: number; rps: number;
  p50: number; p95: number; p99: number; max: number; bytes: number; firstError?: string;
}

function pct(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function loop(base: string, routes: Route[], headers: (r: Route) => HeadersInit, conc: number, ms: number, record: boolean) {
  const lat: number[] = [];
  let errors = 0, bytes = 0, firstError: string | undefined, counter = 0;
  const end = performance.now() + ms;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (performance.now() < end) {
      const i = counter++;
      const r = routes[i % routes.length]!;
      const s = performance.now();
      try {
        const res = await fetch(base + r.path(i), { headers: headers(r) });
        const body = await res.arrayBuffer();
        const d = performance.now() - s;
        if (res.status !== 200) { errors++; firstError ??= `${res.status} ${new TextDecoder().decode(body).slice(0, 200)}`; }
        if (record) { lat.push(d); bytes = body.byteLength; }
      } catch (e) {
        errors++; firstError ??= String(e);
      }
    }
  }));
  return { lat, errors, bytes, firstError, elapsed: performance.now() - t0 };
}

async function run(args: Record<string, string>) {
  const base = args.base!.replace(/\/+$/, '');
  const conc = Number(args.concurrency ?? 32);
  const warmMs = Number(args.warmup ?? 10) * 1000;
  const durMs = Number(args.duration ?? 30) * 1000;
  const primeMs = Number(args.prime ?? 0) * 1000;
  const only = args.routes ? new Set(args.routes.split(',')) : null;
  const routes = ROUTES.filter((r) => !only || only.has(r.name));
  const secret = process.env.BENCH_JWT_SECRET;
  if (!secret) throw new Error('set BENCH_JWT_SECRET to the servers\' AUTH_JWT_SECRET');
  const cookie = `ceitba_session=${mintJwt(secret)}`;
  const headers = (r: Route): HeadersInit => (r.auth ? { cookie, accept: 'application/json' } : { accept: 'application/json' });

  // Preflight: every route answers 200 with a real body, on a few rotated ids.
  const pre: Record<string, number> = {};
  for (const r of routes) {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(base + r.path(i), { headers: headers(r) });
      const text = await res.text();
      if (res.status !== 200 || text.length < 20 || text === '[]' || /"(data|results)":\[\]/.test(text)) {
        throw new Error(`preflight ${r.name} ${r.path(i)}: ${res.status} ${text.slice(0, 300)}`);
      }
      pre[r.name] = text.length;
    }
  }
  console.error(`preflight ok: ${JSON.stringify(pre)}`);

  if (primeMs > 0) {
    console.error(`priming all routes for ${primeMs / 1000}s`);
    await loop(base, routes, headers, conc, primeMs, false);
  }
  const results: Result[] = [];
  for (const r of routes) {
    await loop(base, [r], headers, conc, warmMs, false);
    const m = await loop(base, [r], headers, conc, durMs, true);
    const sorted = Float64Array.from(m.lat).sort();
    const res: Result = {
      route: r.name, samples: sorted.length, errors: m.errors, rps: sorted.length / (m.elapsed / 1000),
      p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), max: sorted[sorted.length - 1] ?? NaN, bytes: m.bytes,
      ...(m.firstError ? { firstError: m.firstError } : {}),
    };
    results.push(res);
    console.error(`${args.label ?? ''} ${r.name.padEnd(24)} p50 ${res.p50.toFixed(1)} p95 ${res.p95.toFixed(1)} p99 ${res.p99.toFixed(1)} ms  ${res.rps.toFixed(0)} req/s  errors ${res.errors}`);
  }
  const out = { label: args.label ?? base, at: new Date().toISOString(), concurrency: conc, warmupS: warmMs / 1000, durationS: durMs / 1000, primeS: primeMs / 1000, results };
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 2));
  else console.log(JSON.stringify(out, null, 2));
}

function compare(aFile: string, bFile: string) {
  const a = JSON.parse(readFileSync(aFile, 'utf8'));
  const b = JSON.parse(readFileSync(bFile, 'utf8'));
  const f = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
  console.log(`| Route | p50 ${a.label} / ${b.label} | p95 ${a.label} / ${b.label} | p99 ${a.label} / ${b.label} | req/s ${a.label} / ${b.label} | errors | p95 ${b.label} vs ${a.label} |`);
  console.log('|---|---|---|---|---|---|---|');
  for (const ra of a.results as Result[]) {
    const rb = (b.results as Result[]).find((x) => x.route === ra.route);
    if (!rb) continue;
    const ratio = rb.p95 / ra.p95;
    console.log(`| \`${ra.route}\` | ${f(ra.p50)} / ${f(rb.p50)} | ${f(ra.p95)} / **${f(rb.p95)}** | ${f(ra.p99)} / ${f(rb.p99)} | ${ra.rps.toFixed(0)} / ${rb.rps.toFixed(0)} | ${ra.errors} / ${rb.errors} | ${ratio <= 1 ? '' : '+'}${((ratio - 1) * 100).toFixed(0)}% |`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const opts: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) if (rest[i]!.startsWith('--')) opts[rest[i]!.slice(2)] = rest[++i]!;
if (cmd === 'seed') console.log(SEED_SQL);
else if (cmd === 'run') await run(opts);
else if (cmd === 'compare') compare(rest[0]!, rest[1]!);
else {
  console.error('usage: load.ts seed | run --base URL [--label L --out F --warmup S --duration S --concurrency N --prime S --routes a,b] | compare A.json B.json');
  process.exit(2);
}

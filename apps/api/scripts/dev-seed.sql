-- Local development seed: fake users, newsletter content, staff page,
-- benefits and scheduler data, so a fresh local stack has something to
-- click through. NEVER run it against production.
--
-- Run it with scripts/dev-seed.sh after the API has started once (Flyway
-- must have created the schema). It is idempotent: every row has a fixed
-- id or natural key, and re-running it updates the rows in place.
--
-- Every date is relative to the day it runs (CURRENT_DATE - INTERVAL ...),
-- so articles read "3 months ago", events stay upcoming and the scheduler's
-- commissions are always in the current term. Re-run it to re-anchor them.
--
-- Users (sign in with the web app's "Dev login" and one of these emails):
--   dev-staff@itba.edu.ar       CEITBA staff (IT leader): /manage, newsletter admin
--   ieee-admin@itba.edu.ar      admin of the IEEE organization
--   turing-member@itba.edu.ar   member of Turing
--   estudiante@itba.edu.ar      student (Informática S10-Rev23), follows orgs, has Apuntes
--   estudiante2@itba.edu.ar     student (Industrial I22)

BEGIN;

-- ── Users ───────────────────────────────────────────────────────────────────

INSERT INTO "user" (id, email, name, career_id, plan, file_number, created_at, updated_at, preferred_language) VALUES
  ('00000000-0000-4000-8000-000000000001', 'dev-staff@itba.edu.ar',     'Valentina Staff',  'S', 'S10-Rev23', 990001, now() - INTERVAL '2 years',  now(), 'es'),
  ('00000000-0000-4000-8000-000000000002', 'ieee-admin@itba.edu.ar',    'Tomás Rivera',     'K', NULL,        990002, now() - INTERVAL '1 year',   now(), 'es'),
  ('00000000-0000-4000-8000-000000000003', 'turing-member@itba.edu.ar', 'Lucía Fernández',  'S', 'S10-Rev23', 990003, now() - INTERVAL '8 months', now(), 'es'),
  ('00000000-0000-4000-8000-000000000004', 'estudiante@itba.edu.ar',    'Martín Gómez',     'S', 'S10-Rev23', 990004, now() - INTERVAL '5 months', now(), 'es'),
  ('00000000-0000-4000-8000-000000000005', 'estudiante2@itba.edu.ar',   'Sofía Martínez',   'I', 'I22',       990005, now() - INTERVAL '3 months', now(), 'en')
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name, career_id = EXCLUDED.career_id, plan = EXCLUDED.plan, updated_at = now();

INSERT INTO ceitba_staff (user_id, branch, role, start, "end")
SELECT id, 'IT', 'LEADER', now() - INTERVAL '1 year', now() + INTERVAL '1 year'
FROM "user" WHERE email = 'dev-staff@itba.edu.ar'
ON CONFLICT (user_id) DO UPDATE SET start = EXCLUDED.start, "end" = EXCLUDED."end";

INSERT INTO user_organizations (user_id, org_slug, role, created_at)
SELECT u.id, m.org, m.role, now() - INTERVAL '6 months'
FROM (VALUES ('ieee-admin@itba.edu.ar', 'ieee', 'admin'),
             ('turing-member@itba.edu.ar', 'turing', 'member')) AS m(email, org, role)
JOIN "user" u ON u.email = m.email
ON CONFLICT (user_id, org_slug) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO user_follows (user_id, org_slug, created_at)
SELECT u.id, f.org, now() - f.ago
FROM (VALUES ('estudiante@itba.edu.ar', 'ceitba', INTERVAL '4 months'),
             ('estudiante@itba.edu.ar', 'ieee',   INTERVAL '2 months'),
             ('estudiante@itba.edu.ar', 'turing', INTERVAL '3 weeks'),
             ('estudiante2@itba.edu.ar', 'ceitba', INTERVAL '1 month'),
             ('estudiante2@itba.edu.ar', 'sabf',  INTERVAL '10 days'),
             ('turing-member@itba.edu.ar', 'ceitba', INTERVAL '6 months')) AS f(email, org, ago)
JOIN "user" u ON u.email = f.email
ON CONFLICT (user_id, org_slug) DO NOTHING;

-- ── Capabilities ────────────────────────────────────────────────────────────

-- The weekly digest toggle for everyone; Apuntes for one student (staff
-- always have every capability).
INSERT INTO capability_settings (capability, enabled_for_all) VALUES ('resumen_semanal', true)
ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true, updated_at = now();
INSERT INTO capability_user_grants (capability, email) VALUES ('apuntes', 'estudiante@itba.edu.ar')
ON CONFLICT DO NOTHING;

-- ── Newsletter: articles ────────────────────────────────────────────────────

INSERT INTO articles (id, title, excerpt, body, category, organization, published_at, reading_time,
                      featured, color_scheme, status, authors, created_by, created_at, updated_at)
SELECT a.id, a.title, a.excerpt, a.body::jsonb, a.category, a.org, CURRENT_DATE - a.ago, a.reading,
       a.featured, a.color, a.status, a.authors::jsonb,
       (SELECT id FROM "user" WHERE email = a.author_email),
       (CURRENT_DATE - a.ago)::timestamptz + INTERVAL '10 hours', now()
FROM (VALUES
  ('seed-bienvenida-cuatrimestre', 'Arranca el cuatrimestre: todo lo que tenés que saber',
   'Inscripciones, horarios, el Combinador y cómo sacarle el jugo a las herramientas de CEITBA.',
   '["## Un cuatrimestre nuevo\n\nEmpieza otra cursada y desde CEITBA armamos esta guía rápida para que no se te pase nada.", "### Inscripciones\n\nRevisá las fechas en el SGA y armá tus opciones con el **Combinador de Horarios** antes de que se llenen los cupos.", "### Herramientas\n\n- Combinador de Horarios\n- Apuntes y wikis por materia\n- Este newsletter, todas las semanas"]',
   'Académico', 'ceitba', INTERVAL '2 days', '4 min', true, 'blue', 'published', '["CEITBA"]', 'dev-staff@itba.edu.ar'),
  ('seed-ieee-hackathon-resultados', 'Resultados de la Hackathon IEEE: ganó un equipo de primer año',
   '48 horas, 30 equipos y un proyecto de monitoreo de aulas que se llevó el primer puesto.',
   '["Más de 120 estudiantes participaron de la hackathon anual de la rama estudiantil IEEE.", "El equipo ganador construyó un sistema para medir la ocupación de las aulas en tiempo real usando sensores de bajo costo.", "> \"No esperábamos ganar, vinimos a aprender\", contó una de las integrantes."]',
   'Tecnología', 'ieee', INTERVAL '9 days', '3 min', false, 'green', 'published', '["Tomás Rivera"]', 'ieee-admin@itba.edu.ar'),
  ('seed-torneo-futbol', 'Se viene el torneo interno de fútbol 5',
   'Inscribí a tu equipo antes del viernes: hay categorías mixta, femenina y masculina.',
   '["El torneo se juega los sábados en el campo de deportes de Parque Patricios.", "Cada equipo necesita al menos 7 integrantes y un capitán que sea alumno regular."]',
   'Deportes', 'ceitba', INTERVAL '3 weeks', '2 min', false, 'amber', 'published', '["Área de Deportes"]', 'dev-staff@itba.edu.ar'),
  ('seed-turing-charla-ia', 'Charla: qué hay detrás de los modelos de lenguaje',
   'Resumen de la charla que organizó Turing con investigadores del laboratorio de IA.',
   '["Turing organizó una charla abierta sobre cómo se entrenan y evalúan los modelos de lenguaje.", "## Lo más destacado\n\n1. Los datos importan más que el tamaño del modelo.\n2. Evaluar es más difícil que entrenar.\n3. Hay mucho lugar para investigación en español."]',
   'Tecnología', 'turing', INTERVAL '5 weeks', '5 min', false, 'violet', 'published', '["Lucía Fernández"]', 'turing-member@itba.edu.ar'),
  ('seed-muestra-trama', 'TRAMA presenta su muestra de fin de año',
   'Fotografía, ilustración y música en vivo en el hall central.',
   '["La muestra reúne trabajos de más de 40 estudiantes.", "La entrada es libre y gratuita."]',
   'Cultura', 'trama', INTERVAL '2 months', '2 min', false, 'violet', 'published', '["TRAMA"]', 'dev-staff@itba.edu.ar'),
  ('seed-sabf-convocatoria', 'SABF abre la convocatoria para su próximo foro',
   'Buscan estudiantes para organización, logística y prensa.',
   '["El Students Association Business Forum vuelve con una nueva edición.", "Si te interesa sumarte, completá el formulario antes de fin de mes."]',
   'Organizaciones', 'sabf', INTERVAL '3 months', '3 min', false, 'amber', 'published', '["SABF"]', 'dev-staff@itba.edu.ar'),
  ('seed-biblioteca-horario', 'La biblioteca extiende su horario en época de parciales',
   'Abre hasta las 22 h de lunes a viernes durante las próximas tres semanas.',
   '["Durante el período de parciales la biblioteca de Sede Distrito Financiero abrirá de 8 a 22 h."]',
   'Campus', NULL, INTERVAL '4 months', '1 min', false, 'blue', 'published', '["Martín Gómez"]', 'estudiante@itba.edu.ar'),
  ('seed-wie-mentorias', 'WIE lanza su programa de mentorías',
   'Estudiantes avanzadas acompañan a las ingresantes durante su primer año.',
   '["Women in Engineering abre las inscripciones de su programa de mentorías.", "Las mentoras se reúnen una vez por mes con su grupo."]',
   'Organizaciones', 'wie', INTERVAL '6 months', '3 min', false, 'green', 'published', '["WIE"]', 'dev-staff@itba.edu.ar'),
  ('seed-elecciones-centro', 'Elecciones del Centro de Estudiantes: cómo votar',
   'Fechas, padrón y dónde están las urnas.',
   '["Las elecciones se realizan durante dos días en ambas sedes.", "Necesitás tu credencial o DNI para votar."]',
   'General', 'ceitba', INTERVAL '1 year', '3 min', false, 'blue', 'published', '["CEITBA"]', 'dev-staff@itba.edu.ar'),
  -- Not published: visible only in the newsletter admin.
  ('seed-ieee-borrador', 'Borrador: workshop de PCBs',
   'Todavía sin fecha confirmada.',
   '["Pendiente: confirmar aula y cupo."]',
   'Tecnología', 'ieee', INTERVAL '0 days', '1 min', false, 'green', 'draft', '["Tomás Rivera"]', 'ieee-admin@itba.edu.ar'),
  ('seed-independiente-pendiente', 'Mi experiencia de intercambio en Alemania',
   'Un cuatrimestre en Múnich: materias, alojamiento y consejos.',
   '["Me fui de intercambio el cuatrimestre pasado y quería compartir lo que aprendí.", "## Antes de viajar\n\nEmpezá los trámites con al menos seis meses de anticipación."]',
   'General', NULL, INTERVAL '1 day', '6 min', false, 'blue', 'pending_review', '["Sofía Martínez"]', 'estudiante2@itba.edu.ar')
) AS a(id, title, excerpt, body, category, org, ago, reading, featured, color, status, authors, author_email)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, body = EXCLUDED.body, category = EXCLUDED.category,
  organization = EXCLUDED.organization, published_at = EXCLUDED.published_at,
  reading_time = EXCLUDED.reading_time, featured = EXCLUDED.featured, color_scheme = EXCLUDED.color_scheme,
  status = EXCLUDED.status, authors = EXCLUDED.authors, created_at = EXCLUDED.created_at, updated_at = now();

INSERT INTO article_votes (article_id, up_count, down_count) VALUES
  ('seed-bienvenida-cuatrimestre', 42, 3),
  ('seed-ieee-hackathon-resultados', 27, 1),
  ('seed-turing-charla-ia', 15, 2),
  ('seed-torneo-futbol', 9, 0)
ON CONFLICT (article_id) DO UPDATE SET up_count = EXCLUDED.up_count, down_count = EXCLUDED.down_count;

-- ── Newsletter: events ──────────────────────────────────────────────────────

INSERT INTO news_events (id, title, event_date, start_time, end_time, location, category, organization,
                         description, created_by, created_at)
SELECT e.id, e.title, CURRENT_DATE + e.offset_days, e.start_t::time, e.end_t::time, e.location, e.category,
       e.org, 'Evento de ejemplo generado por dev-seed.sql.', (SELECT id FROM "user" WHERE email = 'dev-staff@itba.edu.ar'), now()
FROM (VALUES
  ('seed-evt-charla-hoy',      'Charla: cómo armar tu CV técnico',   0,  '18:00', '19:30', 'Aula 401, Sede Distrito Financiero', 'Académico',      'ceitba'),
  ('seed-evt-workshop-git',    'Workshop de Git y GitHub',           2,  '17:00', '20:00', 'Laboratorio 2',                      'Tecnología',     'ieee'),
  ('seed-evt-futbol',          'Torneo de fútbol 5: primera fecha',  5,  '10:00', '14:00', 'Campo de deportes, Parque Patricios', 'Deportes',      'ceitba'),
  ('seed-evt-muestra',         'Muestra de arte TRAMA',              9,  '19:00', '22:00', 'Hall central',                       'Cultura',        'trama'),
  ('seed-evt-sabf',            'SABF: reunión informativa',          14, '18:30', '19:30', 'Auditorio',                          'Organizaciones', 'sabf'),
  ('seed-evt-turing-meetup',   'Meetup de Turing: papers de IA',     21, '18:00', '20:00', 'Aula 203',                           'Tecnología',     'turing'),
  ('seed-evt-feria-empleo',    'Feria de empleo',                    35, '10:00', '17:00', 'Sede Distrito Financiero',           'General',        NULL),
  ('seed-evt-pasado-hackathon','Hackathon IEEE',                     -10,'09:00', '21:00', 'Sede Distrito Financiero',           'Tecnología',     'ieee'),
  ('seed-evt-pasado-charla',   'Charla de bienvenida a ingresantes', -30,'11:00', '12:30', 'Auditorio',                          'Académico',      'ceitba')
) AS e(id, title, offset_days, start_t, end_t, location, category, org)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, event_date = EXCLUDED.event_date, start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time, location = EXCLUDED.location, category = EXCLUDED.category,
  organization = EXCLUDED.organization, description = EXCLUDED.description;

-- ── Home: staff page and benefits ───────────────────────────────────────────

INSERT INTO staff_members (id, year, department_slug, display_order, name, role_es, role_en, email) VALUES
  ('00000000-0000-4000-9000-000000000001', EXTRACT(YEAR FROM CURRENT_DATE)::int, 'directivos', 0, 'Camila Torres',   'Presidenta',          'President',          'presidencia@ceitba.org.ar'),
  ('00000000-0000-4000-9000-000000000002', EXTRACT(YEAR FROM CURRENT_DATE)::int, 'directivos', 1, 'Joaquín Pérez',   'Vicepresidente',      'Vice president',     NULL),
  ('00000000-0000-4000-9000-000000000003', EXTRACT(YEAR FROM CURRENT_DATE)::int, 'it',         0, 'Valentina Staff', 'Líder de IT',         'IT lead',            'it@ceitba.org.ar'),
  ('00000000-0000-4000-9000-000000000004', EXTRACT(YEAR FROM CURRENT_DATE)::int, 'it',         1, 'Nicolás Díaz',    'Desarrollador',       'Developer',          NULL),
  ('00000000-0000-4000-9000-000000000005', EXTRACT(YEAR FROM CURRENT_DATE)::int, 'media',      0, 'Agustina López',  'Diseño y redes',      'Design and social',  NULL),
  ('00000000-0000-4000-9000-000000000006', EXTRACT(YEAR FROM CURRENT_DATE)::int, 'deportes',   0, 'Federico Ruiz',   'Coordinador',         'Coordinator',        NULL),
  ('00000000-0000-4000-9000-000000000007', EXTRACT(YEAR FROM CURRENT_DATE)::int - 1, 'directivos', 0, 'Bruno Sánchez', 'Presidente',      'President',          NULL)
ON CONFLICT (id) DO UPDATE SET year = EXCLUDED.year, name = EXCLUDED.name,
  role_es = EXCLUDED.role_es, role_en = EXCLUDED.role_en, updated_at = now();

INSERT INTO benefit_cards (id, category_slug, display_order, title_es, title_en, summary_es, summary_en,
                           price, bullets_es, bullets_en) VALUES
  ('00000000-0000-4000-a000-000000000001', 'deportes', 0, 'Gimnasio con descuento', 'Discounted gym',
   '20 % de descuento en la cuota mensual.', '20% off the monthly fee.', '20 % off',
   ARRAY['Presentá tu credencial', 'Válido en todas las sedes'], ARRAY['Show your student card', 'Valid at every branch']),
  ('00000000-0000-4000-a000-000000000002', 'idiomas', 0, 'Cursos de inglés', 'English courses',
   'Precio especial para estudiantes ITBA.', 'Special price for ITBA students.', NULL,
   ARRAY['Niveles A1 a C1'], ARRAY['Levels A1 to C1'])
ON CONFLICT (id) DO UPDATE SET title_es = EXCLUDED.title_es, title_en = EXCLUDED.title_en, updated_at = now();

-- ── Scheduler: subjects, plans and commissions ──────────────────────────────

INSERT INTO subject (id, name, credits, updated_at) VALUES
  ('93.58', 'Álgebra',                          9, now()),
  ('93.59', 'Análisis Matemático I',            9, now()),
  ('72.31', 'Programación Imperativa',          9, now()),
  ('93.41', 'Física I',                         6, now()),
  ('72.33', 'Programación Orientada a Objetos', 6, now()),
  ('93.42', 'Física II',                        6, now()),
  ('72.34', 'Estructuras de Datos y Algoritmos',6, now()),
  ('93.24', 'Probabilidad y Estadística',       6, now()),
  ('72.37', 'Base de Datos I',                  6, now()),
  ('72.40', 'Ingeniería del Software I',        6, now()),
  ('72.20', 'Electiva: Desarrollo Web',         3, now()),
  ('11.01', 'Química General',                  6, now()),
  ('11.15', 'Economía para Ingenieros',         6, now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, credits = EXCLUDED.credits, updated_at = now();

INSERT INTO plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies) VALUES
  ('93.58', 'S10-Rev23', 'Materias Obligatorias', 1, 1, 0,  ARRAY[]::varchar[]),
  ('93.59', 'S10-Rev23', 'Materias Obligatorias', 1, 1, 0,  ARRAY[]::varchar[]),
  ('72.31', 'S10-Rev23', 'Materias Obligatorias', 1, 1, 0,  ARRAY[]::varchar[]),
  ('93.41', 'S10-Rev23', 'Materias Obligatorias', 1, 2, 0,  ARRAY['93.59']::varchar[]),
  ('72.33', 'S10-Rev23', 'Materias Obligatorias', 1, 2, 0,  ARRAY['72.31']::varchar[]),
  ('93.42', 'S10-Rev23', 'Materias Obligatorias', 2, 1, 0,  ARRAY['93.41']::varchar[]),
  ('72.34', 'S10-Rev23', 'Materias Obligatorias', 2, 1, 0,  ARRAY['72.33']::varchar[]),
  ('93.24', 'S10-Rev23', 'Materias Obligatorias', 2, 1, 0,  ARRAY['93.59']::varchar[]),
  ('72.37', 'S10-Rev23', 'Materias Obligatorias', 2, 2, 0,  ARRAY['72.34']::varchar[]),
  ('72.40', 'S10-Rev23', 'Materias Obligatorias', 2, 2, 0,  ARRAY['72.33']::varchar[]),
  ('72.20', 'S10-Rev23', 'Electivas',             0, 0, 60, ARRAY[]::varchar[]),
  ('93.58', 'I22',       'Materias Obligatorias', 1, 1, 0,  ARRAY[]::varchar[]),
  ('93.59', 'I22',       'Materias Obligatorias', 1, 1, 0,  ARRAY[]::varchar[]),
  ('11.01', 'I22',       'Materias Obligatorias', 1, 1, 0,  ARRAY[]::varchar[]),
  ('93.41', 'I22',       'Materias Obligatorias', 1, 2, 0,  ARRAY['93.59']::varchar[]),
  ('93.24', 'I22',       'Materias Obligatorias', 2, 1, 0,  ARRAY['93.59']::varchar[]),
  ('11.15', 'I22',       'Materias Obligatorias', 2, 2, 0,  ARRAY[]::varchar[])
ON CONFLICT (subject_id, plan_id) DO UPDATE SET section = EXCLUDED.section, year = EXCLUDED.year,
  semester = EXCLUDED.semester, credits_required = EXCLUDED.credits_required, dependencies = EXCLUDED.dependencies;

-- Commissions run from a month ago to three months from now: always the
-- current term.
INSERT INTO commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
SELECT 'seed-' || c.subject || '-' || c.name, c.subject, c.name,
       CURRENT_DATE - INTERVAL '1 month', CURRENT_DATE + INTERVAL '3 months', c.enrolled, c.quota, 'SEMESTRAL'
FROM (VALUES
  ('93.58', 'A', 58, 60), ('93.58', 'B', 41, 60),
  ('93.59', 'A', 60, 60), ('93.59', 'B', 37, 60),
  ('72.31', 'A', 45, 50), ('72.31', 'B', 30, 50),
  ('93.41', 'A', 52, 60), ('93.41', 'B', 20, 60),
  ('72.33', 'A', 40, 45), ('72.33', 'S', 12, 45),
  ('93.42', 'A', 33, 60),
  ('72.34', 'A', 38, 45), ('72.34', 'B', 25, 45),
  ('93.24', 'A', 50, 70), ('93.24', 'B', 49, 70),
  ('72.37', 'A', 35, 45),
  ('72.40', 'A', 30, 40),
  ('72.20', 'A', 18, 30),
  ('11.01', 'A', 55, 60), ('11.01', 'B', 31, 60),
  ('11.15', 'A', 44, 60)
) AS c(subject, name, enrolled, quota)
ON CONFLICT (id) DO UPDATE SET course_start = EXCLUDED.course_start, course_end = EXCLUDED.course_end,
  enrolled_students = EXCLUDED.enrolled_students, quota = EXCLUDED.quota;

-- Two weekly slots per commission; some overlap on purpose so the
-- combinator has conflicts to resolve.
DELETE FROM commission_time WHERE course_id LIKE 'seed-%';
INSERT INTO commission_time (course_id, day, classroom, building, hour_from, hour_to)
SELECT 'seed-' || t.subject || '-' || t.name, t.day::day_of_week, t.room, 'SDF', t.h_from::time, t.h_to::time
FROM (VALUES
  ('93.58', 'A', 'MONDAY',    '08:00', '11:00', '101'), ('93.58', 'A', 'WEDNESDAY', '08:00', '10:00', '101'),
  ('93.58', 'B', 'TUESDAY',   '14:00', '17:00', '102'), ('93.58', 'B', 'THURSDAY',  '14:00', '16:00', '102'),
  ('93.59', 'A', 'MONDAY',    '11:00', '14:00', '201'), ('93.59', 'A', 'THURSDAY',  '08:00', '11:00', '201'),
  ('93.59', 'B', 'TUESDAY',   '08:00', '11:00', '202'), ('93.59', 'B', 'FRIDAY',    '08:00', '11:00', '202'),
  ('72.31', 'A', 'WEDNESDAY', '10:00', '13:00', 'Lab 1'), ('72.31', 'A', 'FRIDAY',  '14:00', '17:00', 'Lab 1'),
  ('72.31', 'B', 'MONDAY',    '18:00', '21:00', 'Lab 2'), ('72.31', 'B', 'THURSDAY','18:00', '21:00', 'Lab 2'),
  ('93.41', 'A', 'TUESDAY',   '11:00', '14:00', '301'), ('93.41', 'A', 'FRIDAY',    '11:00', '13:00', '301'),
  ('93.41', 'B', 'WEDNESDAY', '14:00', '17:00', '302'), ('93.41', 'B', 'FRIDAY',    '17:00', '19:00', '302'),
  ('72.33', 'A', 'MONDAY',    '14:00', '17:00', 'Lab 3'), ('72.33', 'A', 'WEDNESDAY','14:00', '16:00', 'Lab 3'),
  ('72.33', 'S', 'SATURDAY',  '09:00', '13:00', 'Lab 3'),
  ('93.42', 'A', 'TUESDAY',   '08:00', '11:00', '303'), ('93.42', 'A', 'THURSDAY',  '11:00', '13:00', '303'),
  ('72.34', 'A', 'MONDAY',    '08:00', '11:00', 'Lab 1'), ('72.34', 'A', 'THURSDAY','14:00', '17:00', 'Lab 1'),
  ('72.34', 'B', 'WEDNESDAY', '18:00', '21:00', 'Lab 2'), ('72.34', 'B', 'FRIDAY',  '18:00', '21:00', 'Lab 2'),
  ('93.24', 'A', 'TUESDAY',   '14:00', '17:00', '401'), ('93.24', 'A', 'THURSDAY',  '08:00', '10:00', '401'),
  ('93.24', 'B', 'WEDNESDAY', '08:00', '11:00', '402'), ('93.24', 'B', 'FRIDAY',    '14:00', '16:00', '402'),
  ('72.37', 'A', 'TUESDAY',   '18:00', '21:00', 'Lab 4'), ('72.37', 'A', 'THURSDAY','18:00', '20:00', 'Lab 4'),
  ('72.40', 'A', 'MONDAY',    '18:00', '21:00', '501'), ('72.40', 'A', 'WEDNESDAY', '18:00', '20:00', '501'),
  ('72.20', 'A', 'FRIDAY',    '09:00', '12:00', 'Lab 5'),
  ('11.01', 'A', 'MONDAY',    '14:00', '17:00', 'Lab Q'), ('11.01', 'A', 'WEDNESDAY','11:00', '13:00', 'Lab Q'),
  ('11.01', 'B', 'TUESDAY',   '17:00', '20:00', 'Lab Q'), ('11.01', 'B', 'THURSDAY','17:00', '19:00', 'Lab Q'),
  ('11.15', 'A', 'FRIDAY',    '08:00', '11:00', '601'), ('11.15', 'A', 'TUESDAY',   '11:00', '13:00', '601')
) AS t(subject, name, day, h_from, h_to, room);

COMMIT;

-- Plans for Ingeniería en Biotecnología (B, seeded in V44) and Licenciatura
-- en Ciencias del Comportamiento (LCC, seeded in V6), which had no plan yet.
-- Plan ids are spelled exactly as ITBA's careerPlans expects them.
-- DO NOTHING on conflict: never overwrite a rename or a plan STAFF already
-- registered through the API.
INSERT INTO "public"."careers" (id, name, updated_at) VALUES
    ('B',   'Ingeniería en Biotecnología',                 NOW()),
    ('LCC', 'Licenciatura en Ciencias del Comportamiento', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "public"."plan" (id, career_id, name, updated_at) VALUES
    ('B 25',   'B',   'B 25',   NOW()),
    ('LCC 25', 'LCC', 'LCC 25', NOW())
ON CONFLICT (id) DO NOTHING;

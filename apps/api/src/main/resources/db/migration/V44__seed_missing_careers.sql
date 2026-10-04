-- Careers published by ITBA that were missing from the V6 seed, plus the
-- official name for LN ("Licenciatura en Gestión de Negocios").
INSERT INTO "public"."careers" (id, name, updated_at) VALUES
    ('AER', 'Ingeniería Aeroespacial',                 NOW()),
    ('B',   'Ingeniería en Biotecnología',             NOW()),
    ('LCA', 'Licenciatura en Ciencias Aplicadas',      NOW()),
    ('LN',  'Licenciatura en Gestión de Negocios',     NOW())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW();

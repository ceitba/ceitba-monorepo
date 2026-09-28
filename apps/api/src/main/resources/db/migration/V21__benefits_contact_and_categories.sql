-- Mobile app parity with the Firestore 'Benefits' collection (location,
-- locationUrl, phone, website, email per benefit) and the app's tabs
-- (Convenios / Idiomas / Deportes).

ALTER TABLE benefit_cards
    ADD COLUMN location     TEXT,
    ADD COLUMN location_url TEXT,
    ADD COLUMN phone        VARCHAR(64),
    ADD COLUMN website      TEXT,
    ADD COLUMN email        VARCHAR(255);

-- Display names so clients without the SPA's i18n bundle (the mobile app)
-- can label category tabs. Nullable: the SPA keeps its benefits.<slug>.name
-- keys as a fallback.
ALTER TABLE benefits
    ADD COLUMN name_es VARCHAR(255),
    ADD COLUMN name_en VARCHAR(255);

UPDATE benefits SET name_es = 'Deportes',       name_en = 'Sports'         WHERE slug = 'deportes'       AND name_es IS NULL;
UPDATE benefits SET name_es = 'Membresías',     name_en = 'Memberships'    WHERE slug = 'membresias'     AND name_es IS NULL;
UPDATE benefits SET name_es = 'Eventos',        name_en = 'Events'         WHERE slug = 'eventos'        AND name_es IS NULL;
UPDATE benefits SET name_es = 'Académico',      name_en = 'Academic'       WHERE slug = 'academico'      AND name_es IS NULL;
UPDATE benefits SET name_es = 'Representación', name_en = 'Representation' WHERE slug = 'representacion' AND name_es IS NULL;

INSERT INTO benefits (slug, color_var, display_order, name_es, name_en) VALUES
    ('convenios', '--dept-color-media', 6, 'Convenios', 'Partnerships'),
    ('idiomas',   '--dept-color-infra', 7, 'Idiomas',   'Languages')
ON CONFLICT (slug) DO NOTHING;

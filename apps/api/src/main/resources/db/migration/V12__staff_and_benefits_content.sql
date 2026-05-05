-- Public-facing CMS content for the CeitbaPage SPA: staff directory (per
-- year, per department) and benefit cards. Distinct from `ceitba_staff`,
-- which gates ROLE_STAFF for the management UI itself: a person can be
-- listed as 2025 staff without ever logging in, and a CEITBA admin can
-- have ROLE_STAFF without appearing on the public roster.

CREATE TABLE staff_departments (
    slug          VARCHAR(64) PRIMARY KEY,
    color_var     VARCHAR(64) NOT NULL,
    display_order INT         NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE staff_members (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    year            INT          NOT NULL,
    department_slug VARCHAR(64)  NOT NULL REFERENCES staff_departments(slug),
    display_order   INT          NOT NULL DEFAULT 0,
    name            VARCHAR(255) NOT NULL,
    role_es         VARCHAR(255) NOT NULL,
    role_en         VARCHAR(255) NOT NULL,
    photo_url       TEXT,
    linkedin_url    TEXT,
    email           VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_members_year       ON staff_members (year);
CREATE INDEX idx_staff_members_department ON staff_members (department_slug);

-- Seed: department slugs match the i18n keys baked into the SPA locales,
-- so changing them here would orphan the labels. Keep slugs stable.
INSERT INTO staff_departments (slug, color_var, display_order) VALUES
    ('directivos',      '--dept-color-direct',   1),
    ('it',              '--dept-color-it',       2),
    ('media',           '--dept-color-media',    3),
    ('infraestructura', '--dept-color-infra',    4),
    ('nautica',         '--dept-color-nautica',  5),
    ('deportes',        '--dept-color-deportes', 6)
ON CONFLICT (slug) DO NOTHING;


CREATE TABLE benefits (
    slug           VARCHAR(64)  PRIMARY KEY,
    color_var      VARCHAR(64)  NOT NULL,
    display_order  INT          NOT NULL DEFAULT 0,
    link_url       TEXT,
    contact_email  VARCHAR(255),
    -- highlights are stored per-language as Postgres text[]. We keep the two
    -- columns separate (rather than one nested JSON) so editors can update
    -- one language without round-tripping the other; using text[] instead
    -- of jsonb matches the plan_subject.dependencies convention and avoids
    -- a Hibernate type-resolution clash between JSON and ARRAY for the
    -- same Java type (List<String>) within this package.
    highlights_es  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    highlights_en  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO benefits (slug, color_var, display_order) VALUES
    ('deportes',       '--dept-color-deportes', 1),
    ('membresias',     '--dept-color-media',    2),
    ('eventos',        '--dept-color-direct',   3),
    ('academico',      '--dept-color-infra',    4),
    ('representacion', '--dept-color-it',       5)
ON CONFLICT (slug) DO NOTHING;

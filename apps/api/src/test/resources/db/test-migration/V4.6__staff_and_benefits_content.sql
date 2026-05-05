-- Mirrors prod V12 (DDL-only): staff_departments, staff_members, benefits.
-- The seed INSERTs from V12 are intentionally elided — production seeds are
-- skipped in tests by design (test app.yml caps Flyway target at 4.x and
-- V5+ are seed-bearing). Hibernate's validate step needs these tables to
-- exist so the @Entity classes can be mapped, even when tests don't touch
-- them directly.

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

CREATE TABLE benefits (
    slug           VARCHAR(64)  PRIMARY KEY,
    color_var      VARCHAR(64)  NOT NULL,
    display_order  INT          NOT NULL DEFAULT 0,
    link_url       TEXT,
    contact_email  VARCHAR(255),
    highlights_es  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    highlights_en  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

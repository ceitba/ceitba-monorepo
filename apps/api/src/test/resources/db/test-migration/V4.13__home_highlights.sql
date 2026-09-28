-- Mirrors prod V20 (DDL-only). Tests cap Flyway at target=4.x; this re-applies
-- the schema change so the HomeHighlight @Entity validates against the test DB.

CREATE TABLE home_highlights (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    image_url   TEXT         NOT NULL,
    link_url    TEXT,
    position    INT          NOT NULL DEFAULT 0,
    starts_at   TIMESTAMPTZ,
    ends_at     TIMESTAMPTZ,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT home_highlights_window_chk
        CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX idx_home_highlights_active_position ON home_highlights (active, position);

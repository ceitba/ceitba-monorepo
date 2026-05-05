-- Mirror of prod V14. DDL-only; tests cap Flyway target at 4.x and skip
-- production seeds, so the table needs a sub-4.x version to apply.

CREATE TABLE saved_schedules (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES "public"."user"(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    career_id   VARCHAR(16),
    plan        VARCHAR(255),
    payload     JSONB        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saved_schedules_user ON saved_schedules (user_id);

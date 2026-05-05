-- Per-user saved schedule snapshots from the scheduler SPA. Cap of 5 per user
-- is enforced in the service layer (so the error code can be precise) — no
-- DB trigger here. Payload is opaque to the API: it's whatever the scheduler
-- frontend snapshots (selected commissions, options, blocked times…). Stored
-- as JSONB to keep CRUD trivial; we never query inside the payload.

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

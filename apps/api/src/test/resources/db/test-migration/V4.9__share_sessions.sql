-- Mirrors prod V16 (DDL-only). Tests cap Flyway at target=4.x; this re-applies
-- the schema change so the ShareSession @Entity validates against the test DB.

CREATE TABLE share_sessions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    token           VARCHAR(32)  NOT NULL UNIQUE,
    creator_user_id UUID         NOT NULL REFERENCES "public"."user"(id) ON DELETE CASCADE,
    name            VARCHAR(120),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_share_sessions_creator ON share_sessions (creator_user_id);

CREATE TABLE share_session_participants (
    session_id        UUID         NOT NULL REFERENCES share_sessions(id) ON DELETE CASCADE,
    user_id           UUID         NOT NULL REFERENCES "public"."user"(id) ON DELETE CASCADE,
    saved_schedule_id UUID         REFERENCES saved_schedules(id) ON DELETE SET NULL,
    display_name      VARCHAR(120) NOT NULL,
    joined_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, user_id)
);

CREATE INDEX idx_share_session_participants_user ON share_session_participants (user_id);

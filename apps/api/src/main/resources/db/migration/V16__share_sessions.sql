-- Group share sessions for the scheduler SPA. A user creates a session by
-- attaching one of their saved_schedules; others join by attaching their own
-- saved_schedule. The public viewer fetches all participants by token and
-- renders a heatmap of overlapping busy time. Tokens are random URL-safe
-- strings (12 bytes, base64url, no padding -> 16 chars).
--
-- We keep the participant->saved_schedule reference soft (ON DELETE SET NULL)
-- so that if a user later deletes that saved schedule, their slot in the
-- heatmap simply disappears without nuking the whole session for everyone.

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

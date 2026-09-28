-- A user's "primary" saved schedule: the one the mobile app shows on the home
-- calendar. At most one per user, enforced by a partial unique index so the
-- invariant holds even under concurrent writes. The service makes the first
-- schedule a user creates primary; deleting the primary leaves the user with
-- none (the client picks a new one via PUT /v1/me/schedules/{id}/primary).

ALTER TABLE saved_schedules
    ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX uq_saved_schedules_user_primary
    ON saved_schedules (user_id) WHERE is_primary;

-- Backfill: each existing user's most recently updated schedule becomes
-- primary, so nobody who already saved schedules starts with none.
UPDATE saved_schedules s
SET is_primary = TRUE
FROM (
    SELECT DISTINCT ON (user_id) id
    FROM saved_schedules
    ORDER BY user_id, updated_at DESC, id
) latest
WHERE s.id = latest.id;

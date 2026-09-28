-- Mirror of prod V22. DDL-only (the prod backfill UPDATE is skipped; test
-- databases start empty).

ALTER TABLE saved_schedules
    ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX uq_saved_schedules_user_primary
    ON saved_schedules (user_id) WHERE is_primary;

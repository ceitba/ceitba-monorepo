-- =============================================================================
-- V63__scheduled_job_runs.sql
--
-- When each scheduled job last started (scheduling/JobLock, docs/DEPLOY.md).
-- During a blue/green deploy both API colors fire the same cron tick; the
-- advisory lock only keeps their runs from overlapping, so a color that fires
-- after the other one finished would run the job again. Under the lock, a run
-- claims this row and is skipped if another one started moments ago.
-- job_id is JobLock.Job's stable id (shared with any other process).
-- =============================================================================

CREATE TABLE public.scheduled_job_run (
    job_id          INTEGER     PRIMARY KEY,
    job_name        TEXT        NOT NULL,
    last_started_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.scheduled_job_run (
    job_id          INTEGER     PRIMARY KEY,
    job_name        TEXT        NOT NULL,
    last_started_at TIMESTAMPTZ NOT NULL
);

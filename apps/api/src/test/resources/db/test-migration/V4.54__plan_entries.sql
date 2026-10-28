CREATE TABLE public.plan_entry (
    plan_id          VARCHAR(32)    NOT NULL,
    position         INTEGER        NOT NULL,
    subject_id       VARCHAR(32)    NOT NULL,
    section          VARCHAR(255),
    year             INTEGER,
    semester         INTEGER,
    dependencies     VARCHAR(255)[] NOT NULL,
    credits_required INTEGER,
    subject_name     VARCHAR(255),
    subject_credits  INTEGER        NOT NULL,
    fetched_at       TIMESTAMPTZ    NOT NULL,
    source           VARCHAR(16)    NOT NULL CHECK (source IN ('ITBA', 'BACKFILL')),
    CONSTRAINT plan_entry_pkey PRIMARY KEY (plan_id, position)
);

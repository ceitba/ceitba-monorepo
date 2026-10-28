-- =============================================================================
-- V65__plan_entries.sql
--
-- A plan's subjects exactly as the ITBA gateway sends them (careerPlans), one
-- row per entry in the order received: the same subject may sit in several
-- sections (orientations), and year/semester/credits_required/name/credits
-- are the plan's own values (NULL where ITBA leaves them out). The sync
-- replaces a plan's rows on every fetch; GET /v1/subjects?plan= reads them
-- instead of calling ITBA (docs/PLANS.md). fetched_at is when the sync
-- stored them (the same on every row of a plan); source is ITBA, or BACKFILL
-- for the rows V66 copies from plan_subject until a plan's first sync.
--
-- No FK to plan, like plan_subject: a plan synced by id before staff
-- registers it is stored too.
--
-- plan_subject (key subject + plan: one section per subject, global subject
-- name/credits) is still written by the sync for one release (rollback
-- safety) and dropped after. Additive: no existing column changes.
-- =============================================================================

CREATE TABLE public.plan_entry (
    plan_id          VARCHAR(25)    NOT NULL,
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

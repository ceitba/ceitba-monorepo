-- =============================================================================
-- V65__plan_entries.sql
--
-- A plan's subjects exactly as the ITBA gateway sends them (careerPlans), one
-- row per entry in the order received: the same subject may sit in several
-- sections (orientations), and year/semester/credits_required/name/credits
-- are the plan's own values (NULL where ITBA leaves them out). The sync
-- replaces a plan's rows on every fetch; GET /v1/subjects?plan= reads them
-- instead of calling ITBA (docs/PLANS.md).
--
-- plan_subject (key subject + plan: one section per subject, global subject
-- name/credits) stays as it is for /v1/plans/*; it is retired in a later
-- release once those routes read plan_entry. Additive: no existing column
-- changes.
-- =============================================================================

CREATE TABLE public.plan_entry (
    plan_id          VARCHAR(25)    NOT NULL REFERENCES public.plan (id) ON UPDATE CASCADE ON DELETE CASCADE,
    position         INTEGER        NOT NULL,
    subject_id       VARCHAR(32)    NOT NULL,
    section          VARCHAR(255),
    year             INTEGER,
    semester         INTEGER,
    dependencies     VARCHAR(255)[] NOT NULL,
    credits_required INTEGER,
    subject_name     VARCHAR(255),
    subject_credits  INTEGER        NOT NULL,
    CONSTRAINT plan_entry_pkey PRIMARY KEY (plan_id, position)
);

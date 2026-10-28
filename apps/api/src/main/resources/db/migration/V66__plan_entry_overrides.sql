-- =============================================================================
-- V66__plan_entry_overrides.sql
--
-- Staff edits to a plan's subjects that win over ITBA (docs/PLANS.md "Staff
-- edits"). plan_entry stays an exact copy of what ITBA sends; the sync never
-- touches plan_entry_override (FK to plan: only registered plans are
-- edited). One row per (plan, subject):
--   * a patch on an ITBA subject: each non-NULL field replaces ITBA's value in
--     every entry of the subject (NULL = keep ITBA's); setting section
--     collapses the subject's entries into its first one;
--   * hidden = true: the subject is left out of the plan;
--   * added = true: a subject staff added (one ITBA doesn't send), listed
--     after ITBA's entries with its own values, name and credits from
--     public.subject. A patch (added = false) on a subject ITBA stops sending
--     goes with it.
-- plan_entry_effective is what every reader uses.
--
-- Backfill: until a plan's first sync after this deploy, plan_entry has no
-- rows for it, and the readers moved here (/v1/plans/*, commissions, Apuntes,
-- wiki relations) would see an empty plan. Copy plan_subject as source
-- BACKFILL; the next sync replaces them, and
-- /v1/subjects?plan= still asks ITBA for a plan that only has BACKFILL rows.
-- Every plan in plan_subject, registered or not (plan_entry has no FK).
-- =============================================================================

CREATE TABLE public.plan_entry_override (
    plan_id          VARCHAR(25)    NOT NULL REFERENCES public.plan (id) ON UPDATE CASCADE ON DELETE CASCADE,
    subject_id       VARCHAR(32)    NOT NULL,
    added            BOOLEAN        NOT NULL,
    hidden           BOOLEAN        NOT NULL,
    section          VARCHAR(255),
    year             INTEGER,
    semester         INTEGER,
    dependencies     VARCHAR(255)[],
    credits_required INTEGER,
    created_at       TIMESTAMPTZ    NOT NULL,
    updated_at       TIMESTAMPTZ    NOT NULL,
    CONSTRAINT plan_entry_override_pkey PRIMARY KEY (plan_id, subject_id)
);

CREATE VIEW public.plan_entry_effective AS
SELECT e.plan_id,
       e.position,
       e.subject_id,
       COALESCE(o.section, e.section)                   AS section,
       COALESCE(o.year, e.year)                         AS year,
       COALESCE(o.semester, e.semester)                 AS semester,
       COALESCE(o.dependencies, e.dependencies)         AS dependencies,
       COALESCE(o.credits_required, e.credits_required) AS credits_required,
       COALESCE(e.subject_name, s.name)                 AS subject_name,
       e.subject_credits,
       CASE WHEN o.plan_id IS NULL THEN e.source ELSE 'STAFF' END AS source
FROM public.plan_entry e
LEFT JOIN public.plan_entry_override o ON o.plan_id = e.plan_id AND o.subject_id = e.subject_id
LEFT JOIN public.subject s ON s.id = e.subject_id
WHERE o.hidden IS NOT TRUE
  AND (o.section IS NULL
       OR e.position = (SELECT min(e2.position) FROM public.plan_entry e2
                        WHERE e2.plan_id = e.plan_id AND e2.subject_id = e.subject_id))
UNION ALL
SELECT o.plan_id,
       1000000 + (row_number() OVER (PARTITION BY o.plan_id ORDER BY o.created_at, o.subject_id))::int,
       o.subject_id,
       o.section,
       o.year,
       o.semester,
       COALESCE(o.dependencies, '{}'),
       o.credits_required,
       s.name,
       COALESCE(s.credits, 0),
       'STAFF'
FROM public.plan_entry_override o
LEFT JOIN public.subject s ON s.id = o.subject_id
WHERE o.added AND NOT o.hidden
  AND NOT EXISTS (SELECT 1 FROM public.plan_entry e WHERE e.plan_id = o.plan_id AND e.subject_id = o.subject_id);

INSERT INTO public.plan_entry (plan_id, position, subject_id, section, year, semester, dependencies,
                               credits_required, subject_name, subject_credits, fetched_at, source)
SELECT ps.plan_id,
       (row_number() OVER (PARTITION BY ps.plan_id ORDER BY ps.year = 0, ps.year, ps.semester, ps.section, ps.subject_id))::int - 1,
       ps.subject_id,
       ps.section,
       NULLIF(ps.year, 0),
       NULLIF(ps.semester, 0),
       array_remove(COALESCE(ps.dependencies, '{}'), NULL),
       NULLIF(ps.credits_required, 0),
       s.name,
       COALESCE(s.credits, 0),
       now(),
       'BACKFILL'
FROM public.plan_subject ps
LEFT JOIN public.subject s ON s.id = ps.subject_id
WHERE NOT EXISTS (SELECT 1 FROM public.plan_entry e WHERE e.plan_id = ps.plan_id);

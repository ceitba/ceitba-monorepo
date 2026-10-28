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

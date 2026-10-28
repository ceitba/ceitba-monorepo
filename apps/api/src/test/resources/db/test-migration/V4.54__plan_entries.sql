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

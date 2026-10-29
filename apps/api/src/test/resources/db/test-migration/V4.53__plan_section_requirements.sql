CREATE TABLE public.plan_section_requirement (
    plan_id  VARCHAR(25)  NOT NULL REFERENCES public.plan (id) ON UPDATE CASCADE ON DELETE CASCADE,
    section  VARCHAR(255) NOT NULL,
    credits  INTEGER      NOT NULL,
    year     INTEGER      NOT NULL,
    semester INTEGER      NOT NULL,
    CONSTRAINT plan_section_requirement_pkey PRIMARY KEY (plan_id, section)
);

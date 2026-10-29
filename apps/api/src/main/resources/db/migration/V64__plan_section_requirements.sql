-- =============================================================================
-- V64__plan_section_requirements.sql
--
-- The credits each plan asks for per elective group. The ITBA gateway sends
-- them as term entries of type "section" (docs/ITBA-GATEWAY.md "Elective
-- groups"): `section` is the name of the sibling section that lists the
-- group's subjects (plan_subject.section), placed in that year and term.
-- Written by the sync, which replaces a plan's rows with each fetch.
-- Additive: no existing column changes.
-- =============================================================================

CREATE TABLE public.plan_section_requirement (
    plan_id  VARCHAR(25)  NOT NULL REFERENCES public.plan (id) ON UPDATE CASCADE ON DELETE CASCADE,
    section  VARCHAR(255) NOT NULL,
    credits  INTEGER      NOT NULL,
    year     INTEGER      NOT NULL,
    semester INTEGER      NOT NULL,
    CONSTRAINT plan_section_requirement_pkey PRIMARY KEY (plan_id, section)
);

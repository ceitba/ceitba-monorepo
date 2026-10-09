-- =============================================================================
-- V4.44__commission_term.sql (test mirror of V54)
--
-- The commission table keeps every term the sync job has ever pulled, but a
-- row did not record which one: ITBA's courseCommissions payload has no
-- year/period field and the (year, period) the sync queried with was thrown
-- away. Record it from now on (SyncUpserter stamps the query's term on every
-- upsert) and backfill the rows already here from their course dates, so no
-- existing row is dropped or rewritten beyond the new columns.
--
-- Backfill rule: a course starting January-June belongs to that year's
-- FirstSemester, one starting July-December to its SecondSemester. (Unlike
-- CommissionQuery's default period, January counts as FirstSemester: a
-- summer course belongs with the year it runs in.) Year-long commissions
-- (01/03-31/12) land in FirstSemester, the term they started in.
-- =============================================================================

ALTER TABLE "public"."commission"
    ADD COLUMN "term_year" SMALLINT,
    ADD COLUMN "term_period" VARCHAR(20);

UPDATE "public"."commission"
SET "term_year" = EXTRACT(YEAR FROM "course_start")::SMALLINT,
    "term_period" = CASE WHEN EXTRACT(MONTH FROM "course_start") <= 6
                         THEN 'FirstSemester'
                         ELSE 'SecondSemester' END;

CREATE INDEX "commission_term_idx" ON "public"."commission" ("term_year", "term_period");

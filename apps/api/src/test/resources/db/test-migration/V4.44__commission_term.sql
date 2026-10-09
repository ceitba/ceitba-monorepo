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
-- Backfill rule: the same split CommissionQuery uses for the period the
-- sync queries by default, so a backfilled row and one the sync stamps agree:
-- a course starting February-June belongs to that year's FirstSemester, any
-- other month (July-January) to that year's SecondSemester. A January summer
-- course thus gets the same (year, SecondSemester) the January sync stamps. Year-long commissions
-- (01/03-31/12) land in FirstSemester, the term they started in.
-- =============================================================================

ALTER TABLE "public"."commission"
    ADD COLUMN "term_year" SMALLINT,
    ADD COLUMN "term_period" VARCHAR(20);

UPDATE "public"."commission"
SET "term_year" = EXTRACT(YEAR FROM "course_start")::SMALLINT,
    "term_period" = CASE WHEN EXTRACT(MONTH FROM "course_start") BETWEEN 2 AND 6
                         THEN 'FirstSemester'
                         ELSE 'SecondSemester' END;

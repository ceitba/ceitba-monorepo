-- Apuntes: the academic year a file belongs to (notes and TPs go stale as
-- courses change), shown instead of the last update.
--   drive_created_at      Drive createdTime (backfilled by the next walk)
--   academic_year_user    the year the student set on this item (PATCH), or NULL
--   academic_year         effective year, recomputed on every sync/PATCH:
--   academic_year_source  USER      the item's own academic_year_user
--                         INHERITED an ancestor folder's academic_year_user
--                         NAME      a year in the file name, else in the nearest folder name
--                         DRIVE     year of min(createdTime, modifiedTime) in Buenos Aires
ALTER TABLE "wiki"."drive_file"
    ADD COLUMN "drive_created_at"     TIMESTAMPTZ,
    ADD COLUMN "academic_year_user"   SMALLINT,
    ADD COLUMN "academic_year"        SMALLINT,
    ADD COLUMN "academic_year_source" VARCHAR(16),
    ADD CONSTRAINT "drive_file_academic_year_source_check"
        CHECK ("academic_year_source" IN ('USER', 'INHERITED', 'NAME', 'DRIVE'));

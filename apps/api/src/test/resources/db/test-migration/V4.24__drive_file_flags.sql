-- Test mirror of db/migration/V32__drive_file_flags.sql (DDL only; see README.md).
ALTER TABLE "wiki"."drive_file"
    ADD COLUMN "hidden_by_user" BOOLEAN NOT NULL DEFAULT FALSE;

-- The owner disabled download/export for viewers (Drive cannotExportFile /
-- cannotDownloadFile): kept as metadata only, readers get a link to Drive.
ALTER TABLE "wiki"."drive_file"
    ADD COLUMN "export_blocked" BOOLEAN NOT NULL DEFAULT FALSE;

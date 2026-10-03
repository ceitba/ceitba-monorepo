-- Drive sync: files not owned by the source's student start hidden (they
-- usually are course material or classmates' files the student only has
-- access to). The student can unhide them; they then wait for STAFF review
-- (NEEDS_REVIEW) as before. hidden_by_user records that the student set
-- `hidden` themselves, so a sync never re-applies the default over their
-- choice. Folders are excluded: hiding a folder hides everything in it,
-- including the student's own files.

ALTER TABLE "wiki"."drive_file"
    ADD COLUMN "hidden_by_user" BOOLEAN NOT NULL DEFAULT FALSE;

-- The owner disabled download/export for viewers (Drive cannotExportFile /
-- cannotDownloadFile): kept as metadata only, readers get a link to Drive.
ALTER TABLE "wiki"."drive_file"
    ADD COLUMN "export_blocked" BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing rows: nobody has unhidden anything yet.
UPDATE "wiki"."drive_file"
SET "hidden" = TRUE, "updated_at" = CURRENT_TIMESTAMP
WHERE NOT "owned_by_sharer" AND "kind" <> 'FOLDER' AND NOT "hidden";

-- What PublicationRule now derives for them (hidden -> PRIVATE, except files
-- gone from Drive or removed by staff).
UPDATE "wiki"."drive_file"
SET "publication" = 'PRIVATE'
WHERE "hidden" AND "publication" IN ('NEEDS_REVIEW', 'PUBLISHED', 'HIDDEN_REPORTED');

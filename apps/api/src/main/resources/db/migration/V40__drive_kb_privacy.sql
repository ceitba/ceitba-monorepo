-- Privacy fixes from the #49-#52 review (docs/SUBJECT-WIKI-PIPELINE.md, "Privacy").
--
-- A file's digest goes with the file (it used to be kept with file_id NULL
-- and was still reusable by content fingerprint after the student deleted
-- the file, disconnected the folder or deleted the account).
DELETE FROM "wiki"."kb_file_digest" WHERE "file_id" IS NULL;

ALTER TABLE "wiki"."kb_file_digest" DROP CONSTRAINT "kb_file_digest_file_id_fkey";
ALTER TABLE "wiki"."kb_file_digest" ADD CONSTRAINT "kb_file_digest_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "wiki"."drive_file" ("id") ON DELETE CASCADE;

-- DIGEST requests carry a file's raw text (params) and its digest (result);
-- they are redacted when the file is deleted (KbModerationService.forgetFiles),
-- looked up by target (the file id).
CREATE INDEX "kb_run_request_digest_target_idx" ON "wiki"."kb_run_request" ("target")
    WHERE "stage" = 'DIGEST';

-- Requests of files deleted before this migration.
UPDATE "wiki"."kb_run_request" r SET "params" = '{}'::jsonb, "result" = NULL
WHERE r."stage" = 'DIGEST'
  AND NOT EXISTS (SELECT 1 FROM "wiki"."drive_file" f WHERE f."id"::text = r."target");

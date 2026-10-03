-- Test mirror of V40 (DDL only).
ALTER TABLE "wiki"."kb_file_digest" DROP CONSTRAINT "kb_file_digest_file_id_fkey";
ALTER TABLE "wiki"."kb_file_digest" ADD CONSTRAINT "kb_file_digest_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "wiki"."drive_file" ("id") ON DELETE CASCADE;

CREATE INDEX "kb_run_request_digest_target_idx" ON "wiki"."kb_run_request" ("target")
    WHERE "stage" = 'DIGEST';

-- Wiki pipeline review fixes (#51).
-- DIGEST requests remember the fingerprint of the content they sent, so a
-- digest is stored under it even when the file changes during the run.
ALTER TABLE "wiki"."kb_run_request" ADD COLUMN "content_fingerprint" VARCHAR(64);

-- Requests of a job (sync resume, batch collection, submission).
CREATE INDEX "kb_run_request_batch_job_idx" ON "wiki"."kb_run_request" ("batch_job_id");

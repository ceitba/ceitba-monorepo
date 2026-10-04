-- Wiki pipeline: bounded batches and a restart-loop guard (docs/SUBJECT-WIKI-PIPELINE.md, "Memory").

-- A stage with more than KB_BATCH_MAX_REQUESTS requests of one model is split
-- into several batch jobs (parts 1..n); part 1 keeps the pre-split request id.
ALTER TABLE "wiki"."kb_batch_job" ADD COLUMN "part" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "wiki"."kb_batch_job_once_idx";
CREATE UNIQUE INDEX "kb_batch_job_once_idx" ON "wiki"."kb_batch_job" ("run_id", "stage", "attempt", "model", "part");

-- Startup resumes of a run inside a short window without finishing a stage;
-- too many marks the run FAILED instead of resuming it into another crash.
ALTER TABLE "wiki"."kb_run"
    ADD COLUMN "resume_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "resume_window_start" TIMESTAMPTZ;

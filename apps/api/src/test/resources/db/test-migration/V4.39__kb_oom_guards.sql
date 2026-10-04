-- Test mirror of V49 (DDL only). Bounded batches and a restart-loop guard.
ALTER TABLE "wiki"."kb_batch_job" ADD COLUMN "part" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "wiki"."kb_batch_job_once_idx";
CREATE UNIQUE INDEX "kb_batch_job_once_idx" ON "wiki"."kb_batch_job" ("run_id", "stage", "attempt", "model", "part");

ALTER TABLE "wiki"."kb_run"
    ADD COLUMN "resume_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "resume_window_start" TIMESTAMPTZ;

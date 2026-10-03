-- Test mirror of V38 (DDL only). DigitalOcean batch submission (docs/SUBJECT-WIKI-PIPELINE.md, "Batch submission").

-- The model id batch JSONL lines use. DO's batch API takes native provider
-- ids (gpt-6-luna) where serverless chat takes the catalog id
-- (openai-gpt-6-luna). NULL = the catalog id without its openai-/anthropic-
-- prefix; a batch probe stores whichever form DO accepted.
ALTER TABLE "wiki"."kb_model" ADD COLUMN "batch_model_id" VARCHAR(128);

-- A batch job row is created (QUEUED) before DO is called, so a stage is
-- submitted at most once per attempt and model; a rate-limited creation
-- stays QUEUED until next_attempt_at.
ALTER TABLE "wiki"."kb_batch_job"
    ADD COLUMN "next_attempt_at" TIMESTAMPTZ,
    ADD COLUMN "submit_failures" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "do_request_id"   VARCHAR(255);
ALTER TABLE "wiki"."kb_batch_job" DROP CONSTRAINT "kb_batch_job_status_check";
ALTER TABLE "wiki"."kb_batch_job" ADD CONSTRAINT "kb_batch_job_status_check" CHECK ("status" IN
    ('DRY', 'QUEUED', 'SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED'));
CREATE UNIQUE INDEX "kb_batch_job_once_idx" ON "wiki"."kb_batch_job" ("run_id", "stage", "attempt", "model");
CREATE INDEX "kb_batch_job_queued_idx" ON "wiki"."kb_batch_job" ("next_attempt_at") WHERE "status" = 'QUEUED';

-- PARTIAL: some subjects (pipeline) or configurations (eval) failed, not all.
ALTER TABLE "wiki"."kb_run" DROP CONSTRAINT "kb_run_status_check";
ALTER TABLE "wiki"."kb_run" ADD CONSTRAINT "kb_run_status_check" CHECK ("status" IN
    ('RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'));

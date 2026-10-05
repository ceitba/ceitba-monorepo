-- =============================================================================
-- V53__kb_widen_model_fields.sql
--
-- kb_run.model holds "digest|plan|write" model ids and kb_run_request.target
-- holds an eval's "plan|write@effort#slug". With custom endpoint models
-- (custom:<endpoint>:<model>, up to 128 chars each) both overflowed
-- VARCHAR(128) and starting a run failed with a data integrity error.
-- =============================================================================

ALTER TABLE "wiki"."kb_run"
    ALTER COLUMN "model" TYPE VARCHAR(512),
    ALTER COLUMN "generator" TYPE VARCHAR(512);

ALTER TABLE "wiki"."kb_run_request"
    ALTER COLUMN "target" TYPE VARCHAR(512);

-- Test mirror of V53.
ALTER TABLE "wiki"."kb_run"
    ALTER COLUMN "model" TYPE VARCHAR(512),
    ALTER COLUMN "generator" TYPE VARCHAR(512);

ALTER TABLE "wiki"."kb_run_request"
    ALTER COLUMN "target" TYPE VARCHAR(512);

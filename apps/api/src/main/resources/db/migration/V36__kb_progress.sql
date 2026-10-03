-- Progress of wiki pipeline runs and evals (docs/SUBJECT-WIKI-ADMIN.md, "Progress").
-- When each request finished and how long it took (sync), DO's view of a
-- batch, and when each stage of a run started and finished.
ALTER TABLE "wiki"."kb_run_request"
    ADD COLUMN "completed_at" TIMESTAMPTZ,
    ADD COLUMN "latency_ms"   INTEGER;

ALTER TABLE "wiki"."kb_batch_job"
    ADD COLUMN "do_status"         VARCHAR(32),
    ADD COLUMN "do_request_counts" JSONB,
    ADD COLUMN "status_changed_at" TIMESTAMPTZ;

-- {"<STAGE>": {"startedAt": "...", "finishedAt": "..."}}
ALTER TABLE "wiki"."kb_run"
    ADD COLUMN "stage_log" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX "kb_llm_usage_request_idx" ON "wiki"."kb_llm_usage" ("request_id");

-- One row per HTTP call: attempt number within the request, wall time
-- (sync) and reasoning tokens when the API reports them.
ALTER TABLE "wiki"."kb_llm_usage"
    ADD COLUMN "attempt"          INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "latency_ms"       INTEGER,
    ADD COLUMN "reasoning_tokens" INTEGER;

-- Prices from DigitalOcean's public model catalog (POST /models/sync).
ALTER TABLE "wiki"."kb_model"
    ADD COLUMN "max_output_tokens"   INTEGER,
    ADD COLUMN "price_source"        VARCHAR(32),
    ADD COLUMN "display_name_manual" BOOLEAN NOT NULL DEFAULT FALSE;

-- Every change of a catalog field (prices, context, names) and its source:
-- do-catalog | manual.
CREATE TABLE "wiki"."kb_model_price_history" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "model_id"   VARCHAR(128) NOT NULL,
    "field"      VARCHAR(32)  NOT NULL,
    "old_value"  TEXT,
    "new_value"  TEXT,
    "changed_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source"     VARCHAR(32)  NOT NULL,
    CONSTRAINT "kb_model_price_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_model_price_history_model_fkey"
        FOREIGN KEY ("model_id") REFERENCES "wiki"."kb_model" ("id") ON DELETE CASCADE
);
CREATE INDEX "kb_model_price_history_model_idx" ON "wiki"."kb_model_price_history" ("model_id", "changed_at" DESC);

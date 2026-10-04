-- Wiki pipeline: files of a subject left out of a run because no DIGEST was produced for them
-- (the subject went on without them; they stay pending and are retried next run).
ALTER TABLE "wiki"."kb_run_subject" ADD COLUMN "skipped" JSONB NOT NULL DEFAULT '[]'::jsonb;

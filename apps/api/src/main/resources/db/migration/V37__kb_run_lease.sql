-- One advancer per run (kick, batch poller and safety sweep may race): a
-- lease taken with a conditional UPDATE and renewed while the run advances.
ALTER TABLE "wiki"."kb_run"
    ADD COLUMN "lease_owner" VARCHAR(64),
    ADD COLUMN "lease_until" TIMESTAMPTZ;

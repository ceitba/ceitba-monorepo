-- Custom endpoint models: catalog ids are slash-free (custom:<endpoint>:<slug>) so the
-- /models/{id} routes work; the id the endpoint itself knows lives here.
ALTER TABLE "wiki"."kb_model" ADD COLUMN "remote_model_id" VARCHAR(512);

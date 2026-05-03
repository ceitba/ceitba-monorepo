-- V2 created key_hash as CHAR(64); Hibernate maps String to VARCHAR, causing
-- schema validation failure. Convert to VARCHAR(64) to match entity mapping.
ALTER TABLE public.api_keys
    ALTER COLUMN key_hash TYPE VARCHAR(64) USING key_hash::varchar;

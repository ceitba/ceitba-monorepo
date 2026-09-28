-- Mirrors prod V21 (DDL-only; the category seed and name backfill are
-- elided like every other seed). Tests cap Flyway at target=4.x.

ALTER TABLE benefit_cards
    ADD COLUMN location     TEXT,
    ADD COLUMN location_url TEXT,
    ADD COLUMN phone        VARCHAR(64),
    ADD COLUMN website      TEXT,
    ADD COLUMN email        VARCHAR(255);

ALTER TABLE benefits
    ADD COLUMN name_es VARCHAR(255),
    ADD COLUMN name_en VARCHAR(255);

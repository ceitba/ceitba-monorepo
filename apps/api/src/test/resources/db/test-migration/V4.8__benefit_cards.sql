-- Mirrors prod V15 (DDL-only). Tests cap Flyway at target=4.x; this re-applies
-- the schema change so the BenefitCard @Entity validates against the test DB.

CREATE TABLE benefit_cards (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    category_slug   VARCHAR(64)  NOT NULL REFERENCES benefits(slug) ON DELETE CASCADE,
    display_order   INT          NOT NULL DEFAULT 0,
    title_es        VARCHAR(255) NOT NULL,
    title_en        VARCHAR(255) NOT NULL,
    summary_es      TEXT         NOT NULL DEFAULT '',
    summary_en      TEXT         NOT NULL DEFAULT '',
    image_url       TEXT,
    cta_url         TEXT,
    cta_label_es    VARCHAR(255),
    cta_label_en    VARCHAR(255),
    price           VARCHAR(255),
    bullets_es      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    bullets_en      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_benefit_cards_category ON benefit_cards (category_slug);
CREATE INDEX idx_benefit_cards_order    ON benefit_cards (display_order);

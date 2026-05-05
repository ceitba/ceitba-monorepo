-- Benefit cards: individual benefits the CEITBA offers, filed under one of
-- the existing `benefits` rows which now act as categories ("sports",
-- "discounts", "events", ...). The five seed rows in V12 keep their slugs
-- so the SPA's i18n labels (benefits.<slug>.name) continue to render the
-- chip labels — the rows are just reframed as category metadata, not
-- standalone cards.

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
    -- Bullets stored as text[] mirroring the convention used for the
    -- legacy benefits.highlights_* columns; lets editors edit one
    -- language without touching the other.
    bullets_es      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    bullets_en      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_benefit_cards_category ON benefit_cards (category_slug);
CREATE INDEX idx_benefit_cards_order    ON benefit_cards (display_order);

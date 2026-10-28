-- =============================================================================
-- V64__newsletter_comments_polls.sql
--
-- Comments and polls on newsletter articles (docs/NEWSLETTER-ENGAGEMENT.md).
-- Additive only: a defaulted column on articles and new tables.
-- =============================================================================

ALTER TABLE public.articles ADD COLUMN comments_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE public.article_comments (
    id          UUID        PRIMARY KEY,
    article_id  TEXT        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    -- NULL once the author deleted their account (the comment is a tombstone). SET NULL so an
    -- API image older than this feature can still delete a commenter's account on a rollback.
    user_id     UUID        REFERENCES public."user"(id) ON DELETE SET NULL,
    -- One level of replies: the parent is a top-level comment (enforced by the API).
    parent_id   UUID        REFERENCES public.article_comments(id) ON DELETE CASCADE,
    body        TEXT        NOT NULL,
    pinned      BOOLEAN     NOT NULL DEFAULT false,
    hidden_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX article_comments_article_idx ON public.article_comments (article_id, created_at);
CREATE INDEX article_comments_parent_idx ON public.article_comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX article_comments_user_idx ON public.article_comments (user_id) WHERE user_id IS NOT NULL;
-- One pinned comment per article.
CREATE UNIQUE INDEX article_comments_one_pin_idx ON public.article_comments (article_id) WHERE pinned;

CREATE TABLE public.article_comment_likes (
    comment_id  UUID        NOT NULL REFERENCES public.article_comments(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX article_comment_likes_user_idx ON public.article_comment_likes (user_id);

CREATE TABLE public.article_comment_reports (
    comment_id  UUID        NOT NULL REFERENCES public.article_comments(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX article_comment_reports_user_idx ON public.article_comment_reports (user_id);

CREATE TABLE public.article_polls (
    id                  UUID        PRIMARY KEY,
    article_id          TEXT        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    question            TEXT        NOT NULL,
    results_visibility  TEXT        NOT NULL DEFAULT 'after_vote'
                                    CHECK (results_visibility IN ('after_vote', 'after_close')),
    closes_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL
);
CREATE INDEX article_polls_article_idx ON public.article_polls (article_id, created_at);

CREATE TABLE public.article_poll_options (
    id        UUID    PRIMARY KEY,
    poll_id   UUID    NOT NULL REFERENCES public.article_polls(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    label     TEXT    NOT NULL,
    UNIQUE (poll_id, position)
);

CREATE TABLE public.article_poll_votes (
    poll_id     UUID        NOT NULL REFERENCES public.article_polls(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    option_id   UUID        NOT NULL REFERENCES public.article_poll_options(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (poll_id, user_id)
);
CREATE INDEX article_poll_votes_option_idx ON public.article_poll_votes (option_id);
CREATE INDEX article_poll_votes_user_idx ON public.article_poll_votes (user_id);

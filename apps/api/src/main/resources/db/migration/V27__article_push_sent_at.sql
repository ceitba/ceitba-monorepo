-- When the "new article" push for an article was triggered (ArticleService).
-- Set once, the first time the article is published; a later unpublish and
-- republish does not push again, since org followers (every user, for
-- 'ceitba') were already notified about that article.
ALTER TABLE "public"."articles"
    ADD COLUMN "push_sent_at" TIMESTAMPTZ;

-- Articles already published before pushes existed count as announced, so
-- toggling one of them draft -> published does not push a stale article.
-- created_at is nullable on legacy rows; those still count as announced.
UPDATE "public"."articles"
SET "push_sent_at" = COALESCE("created_at", now())
WHERE "status" = 'published';

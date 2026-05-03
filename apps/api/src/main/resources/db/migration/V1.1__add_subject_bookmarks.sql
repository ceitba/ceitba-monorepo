-- wiki."subject_bookmarks" was missing from the V1 baseline (it existed on
-- prod as a Prisma-created table but was never captured in migrations).
-- IF NOT EXISTS makes this a no-op on production where the table already
-- exists under its Prisma name; on fresh databases it creates it correctly.

CREATE TABLE IF NOT EXISTS wiki."subject_bookmarks" (
    "subject_id" VARCHAR(25)  NOT NULL,
    "user_id"    UUID         NOT NULL,
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_bookmarks_pkey" PRIMARY KEY ("subject_id", "user_id")
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'wiki'
          AND constraint_name   = 'subject_bookmarks_subject_id_fkey'
    ) THEN
        ALTER TABLE wiki."subject_bookmarks"
            ADD CONSTRAINT "subject_bookmarks_subject_id_fkey"
            FOREIGN KEY ("subject_id") REFERENCES public."subject" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'wiki'
          AND constraint_name   = 'subject_bookmarks_user_id_fkey'
    ) THEN
        ALTER TABLE wiki."subject_bookmarks"
            ADD CONSTRAINT "subject_bookmarks_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES public."user" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

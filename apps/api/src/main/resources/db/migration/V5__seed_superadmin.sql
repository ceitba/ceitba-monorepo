-- Seed the main CEITBA institutional account as permanent staff.
-- ON CONFLICT clauses make this idempotent: safe whether the account
-- has already logged in (user row exists) or not.

INSERT INTO "public"."user" ("id", "email", "name", "created_at", "updated_at")
VALUES (
    gen_random_uuid(),
    'ceitba@itba.edu.ar',
    'CEITBA',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO NOTHING;

INSERT INTO "public"."ceitba_staff" ("user_id", "branch", "role", "start", "end")
SELECT "id", 'DIRECTIVES', 'PRESIDENT', CURRENT_TIMESTAMP, '9999-12-31 23:59:59+00'
FROM "public"."user"
WHERE "email" = 'ceitba@itba.edu.ar'
ON CONFLICT ("user_id") DO UPDATE
    SET "branch" = 'DIRECTIVES',
        "role"   = 'PRESIDENT',
        "end"    = '9999-12-31 23:59:59+00';

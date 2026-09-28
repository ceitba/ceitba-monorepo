-- Optional social handles on the user profile (PATCH /v1/me/profile).
-- Stored as normalized handles, never as URLs: the API accepts a handle,
-- an @handle or a profile URL and keeps only the handle (see
-- service/user/SocialHandles). Lengths are the platforms' own limits:
-- LinkedIn custom URLs 3-100, Instagram 30, Discord 32 (+ "#1234" for
-- legacy tags).
ALTER TABLE "public"."user"
    ADD COLUMN "linkedin"  VARCHAR(100),
    ADD COLUMN "instagram" VARCHAR(30),
    ADD COLUMN "discord"   VARCHAR(37);

-- When the SGA academic prefill last got an answer for this user (found or
-- not found; gateway failures leave it NULL). The login hook only syncs
-- while it is NULL, so users SGA cannot resolve are not looked up on every
-- login and fields a user cleared are not refilled; the explicit
-- POST /v1/me/profile/sync-from-sga still runs regardless.
ALTER TABLE "public"."user"
    ADD COLUMN "sga_synced_at" TIMESTAMPTZ;

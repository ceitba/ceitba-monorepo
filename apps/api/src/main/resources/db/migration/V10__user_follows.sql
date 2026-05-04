-- =============================================================================
-- V10__user_follows.sql
--
-- Lets every authenticated user follow / unfollow organisations from the
-- newsletter. Pair table to user_organizations: this one is purely a
-- newsfeed subscription, while user_organizations confers admin rights.
--
-- The backfill subscribes every existing user to CEITBA. For users created
-- after this migration, UserProvisioningService inserts the row at the same
-- moment the User row is saved.
-- =============================================================================

CREATE TABLE public.user_follows (
    user_id    UUID         NOT NULL REFERENCES public."user"(id)         ON DELETE CASCADE,
    org_slug   TEXT         NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_slug)
);

CREATE INDEX user_follows_org_idx  ON public.user_follows(org_slug);
CREATE INDEX user_follows_user_idx ON public.user_follows(user_id);

INSERT INTO public.user_follows (user_id, org_slug)
SELECT id, 'ceitba' FROM public."user"
ON CONFLICT DO NOTHING;

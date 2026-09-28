-- =============================================================================
-- V23__user_devices.sql
--
-- Push-notification device registry (FCM registration tokens) for the mobile
-- app: PUT /v1/me/devices upserts, DELETE /v1/me/devices/{token} removes.
--
-- The token is the primary key: one device (token) belongs to exactly one user
-- at a time. Re-registering a token under another account (shared phone, user
-- switch) reassigns the row instead of duplicating it, so the previous owner
-- stops receiving pushes on that device. Tokens that FCM reports as
-- UNREGISTERED / INVALID_ARGUMENT are deleted by the sender.
--
-- FCM registration tokens are ~150-250 characters; 1024 leaves ample room
-- while keeping the primary-key index entries small.
-- =============================================================================

CREATE TABLE public.user_devices (
    token        VARCHAR(1024) NOT NULL,
    user_id      UUID          NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    platform     VARCHAR(16)   NOT NULL,
    app_version  VARCHAR(32),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT user_devices_pkey PRIMARY KEY (token),
    CONSTRAINT user_devices_platform_check CHECK (platform IN ('ios', 'android'))
);

CREATE INDEX user_devices_user_idx ON public.user_devices(user_id);

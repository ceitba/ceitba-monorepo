-- =============================================================================
-- V62__api_key_scopes.sql
--
-- Scoped user API keys (used by the MCP server, apps/mcp). A key carries a
-- comma-separated subset of: read, write, staff (see ApiKeyScope).
--   read   GET/HEAD only (always present)
--   write  non-safe methods (POST/PUT/PATCH/DELETE)
--   staff  keeps ROLE_STAFF / ROLE_MODERATOR when the owner holds them
-- Existing keys were full-power, so they keep all three.
-- =============================================================================

ALTER TABLE "public"."api_keys"
    ADD COLUMN "scopes" VARCHAR(64) NOT NULL DEFAULT 'read,write,staff';

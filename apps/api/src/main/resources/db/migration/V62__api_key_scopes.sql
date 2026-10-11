-- =============================================================================
-- V62__api_key_scopes.sql
--
-- Scoped user API keys (used by the MCP server, apps/mcp). A key carries a
-- comma-separated subset of: read, report, write, staff, keys (see ApiKeyScope).
--   read   GET/HEAD only (always present)
--   report reporting wiki pages / Apuntes files (implied by write)
--   write  non-safe methods (POST/PUT/PATCH/DELETE)
--   staff  keeps ROLE_STAFF / ROLE_MODERATOR when the owner holds them
--   keys   create API keys and revoke other keys
-- Existing keys were full-power, so they get every scope.
-- =============================================================================

ALTER TABLE "public"."api_keys"
    ADD COLUMN "scopes" VARCHAR(64) NOT NULL DEFAULT 'read,report,write,staff,keys';

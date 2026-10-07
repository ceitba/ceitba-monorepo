# apps/mcp: CEITBA MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants (Claude, ChatGPT,
Cursor, VS Code, Kiro, ...) access to CEITBA data through the API (`apps/api`). It can run in two ways:

| Mode | Entry | Auth | For |
|---|---|---|---|
| **Hosted**: Streamable HTTP at `https://mcp.ceitba.org.ar/mcp` | `src/http.ts` | OAuth 2.1 (sign in with the ITBA Google account), or a `ceitba_` API key as the bearer token | Everyone: Claude.ai and ChatGPT connectors, and any client that supports remote servers |
| **Local**: stdio | `src/stdio.ts` | Optional `CEITBA_API_KEY` | Desktop clients, offline development |

User-facing setup guide (Spanish, then English): **[CONECTAR.md](CONECTAR.md)**.

Stack: Bun 1.4, TypeScript, `@modelcontextprotocol/sdk`, zod, express (from the SDK), `bun:sqlite`.
The schedule combiner comes from `packages/scheduler-core`, the same code `apps/scheduler` runs.

## Tools

The tools a session can list depend on who is signed in and on the credential's scopes. Tools a session can't use are
hidden (`src/tools/define.ts` `isVisible`). Descriptions are written in Spanish first, then English. Output is compact
JSON with trimmed fields, short times (`Lun 08:00-10:00 SDF 101`), and long text split into pages with `offset`.

| Access | Tools |
|---|---|
| Public | `list_careers`, `get_plan_subjects`, `get_subject`, `get_subject_commissions`, `find_free_classrooms`, `check_classroom_conflicts`, `generate_schedules`, `get_share_session`, `list_articles`, `get_article`, `list_events`, `list_organizations`, `get_organization`, `list_benefits`, `list_staff_members`, `list_highlights` |
| Signed in | `whoami`, `list_my_schedules`, `list_my_follows`, `get_digest_subscription`, `list_my_schedule_corrections`, `list_study_groups`, `get_study_group`, `list_my_study_groups`, `list_proposals`, `get_proposal`, `list_my_bookmarks` |
| Signed in + `apuntes` capability | `search_apuntes`, `list_subject_files`, `get_subject_wiki`, `get_wiki_page` |
| Staff (`staff` scope) | `staff_list_schedule_corrections`, `staff_search_users`, `staff_list_digests`, `staff_analytics_summary` |
| Moderator or staff (`staff` scope) | `moderation_list_proposals` |
| **Writes**: staff/moderator + `write` scope | `staff_review_schedule_correction` (apply/reject), `moderation_review_proposal` (approve/reject) |

Students are read-only by design. Only staff and moderators get write tools, and those tools are marked
`destructiveHint`.

Resources: `ceitba://plan/{planId}` (a plan's subjects) and `ceitba://wiki/{subjectId}/{slug}` (a wiki page as
markdown, needs `apuntes`). Prompts: `planificar_cuatrimestre`, `estudiar_materia`, `que_hay_esta_semana`.

Never exposed: auth and token endpoints, `/sync/**`, the KB pipeline and model admin, mail, account deletion, devices
and push, analytics ingestion, uploads, Drive source management, role and capability grants, and article votes. Votes
are anonymous and deduplicated by IP, so every user of the hosted server would count as one voter.

## How auth works

**Scoped API keys (API side).** User API keys carry scopes (`apps/api/docs/AUTH-SETUP.md` § Scopes):

- `read`: GET only.
- `write`: non-safe methods.
- `staff`: keeps STAFF/MODERATOR.

A scoped key cannot mint keys, but can revoke itself. The owner must still pass the email allowlist.

**OAuth bridge (hosted mode).** This server is its own OAuth 2.1 authorization server. The SDK's `mcpAuthRouter`
provides metadata, dynamic client registration, PKCE, token and revoke. `src/oauth/provider.ts` does the CEITBA part:

1. The MCP client calls `/authorize`. We store the request (10 min) and redirect the user to Google.
2. Google redirects to `/oauth/google/callback`, and we exchange the code for an ID token.
3. `POST /api/v1/auth/google/mobile {idToken, nonce}`. The API verifies the token, the allowlist and the `hd` domain,
   then returns a short session.
4. With that session we create a **scoped API key**: `["read"]` for students, `["read","staff","write"]` for staff and
   moderators (narrowed further if the client asked for fewer scopes). Then we log the session out.
5. We issue our own opaque access token (1 h) and refresh token (rotating, lives as long as the grant, 90 days by
   default) to the MCP client.

**Storage.** Only the encrypted API key is stored (AES-256-GCM, `MCP_ENCRYPTION_KEY`). Tokens are stored as SHA-256
hashes in SQLite (`MCP_DB_PATH`).

**Revocation and cleanup:**

- Revoking a refresh token, or the API rejecting the key, deletes the grant and revokes the API key.
- A periodic sweep removes expired grants and abandoned logins.

The API's JWT secret never leaves the API, and the API remains the only judge of who can sign in.

**Raw API keys.** `Authorization: Bearer ceitba_...` is also accepted, for clients without OAuth. Disable it with
`MCP_ALLOW_API_KEY_BEARER=false`. The API enforces the key's real scopes.

**Rate limits and client IP.** Each user gets a token bucket, `MCP_RATE_LIMIT_PER_MINUTE` (60) tool calls per minute.
Every API call carries `X-Forwarded-For: <end-user IP>`. The API trusts the right-most entry from private peers, and
the container reaches it over the Docker network, so the API's per-IP limits stay per user.

**Logs.** JSON lines on stderr: `{event:"tool_call", tool, userId, client, status, durationMs, apiStatus}`. They
contain the user id, never the email, and never the arguments.

**Stateless HTTP.** Each `POST /mcp` builds a server for the caller's identity, cached for 5 min per key. There are no
sessions, so `GET` and `DELETE /mcp` answer 405.

## Develop

From the repo root:

```sh
bun install
bun run --filter @ceitba/mcp test      # bun test (fake API, full OAuth flow, tools)
bun run --filter @ceitba/mcp lint      # tsc --noEmit
```

**Local stdio against production (public data):**

```sh
cd apps/mcp && bun src/stdio.ts
```

**Local stdio against a local API** (`apps/api` with `docker compose up -d`):

```sh
CEITBA_API_URL=http://localhost:8080/api CEITBA_API_KEY=ceitba_... bun src/stdio.ts
```

Inspect it with the MCP inspector:

```sh
bunx @modelcontextprotocol/inspector bun src/stdio.ts
```

**Hosted mode locally** needs a Google OAuth client with redirect URI `http://localhost:8787/oauth/google/callback`.
Its client id must be in the API's `AUTH_GOOGLE_MOBILE_AUDIENCES`.

```sh
cp .env.example .env    # set CEITBA_API_URL=http://localhost:8080/api, MCP_PUBLIC_URL=http://localhost:8787
bun --env-file=.env src/http.ts
```

## Deploy

CI (`ci.yml`, job `mcp-test`) typechecks, tests and builds the image. On `main`, `deploy.yml` runs `mcp-test`, then
`mcp-image` (pushes `ghcr.io/ceitba/ceitba-mcp`), then `mcp-deploy` (copies `docker-compose.yml` to `~/CEITBA-MCP`, then
pulls and starts the container). It runs after the API deploy. Caddy serves it at `mcp.ceitba.org.ar`
(`infra/caddy/Caddyfile`).

One-time setup:

1. **DNS.** Add an `A`/`AAAA` record for `mcp.ceitba.org.ar` pointing at the VPS. Caddy gets the certificate on the
   first request.
2. **Google Cloud Console.** Use a new OAuth web client (recommended) or the existing one. Add the authorized redirect
   URI `https://mcp.ceitba.org.ar/oauth/google/callback`.
3. **API.** Add that client id to `AUTH_GOOGLE_MOBILE_AUDIENCES` in `~/CEITBA-API/.env` (comma separated), and deploy
   the API first, since V54 adds key scopes.
4. **VPS.** Run `mkdir ~/CEITBA-MCP`, then create `~/CEITBA-MCP/.env` from [.env.example](.env.example)
   (`MCP_ENCRYPTION_KEY=$(openssl rand -base64 32)`, plus the Google client id and secret). Back up
   `MCP_ENCRYPTION_KEY`: losing it invalidates every MCP sign-in, and users only need to connect again.

The SQLite store lives in the `mcp_data` volume. Deleting it signs everyone out of MCP. The API keys it held expire on
their own, and users can revoke them from `GET /api/v1/auth/api-keys`; they are named `MCP · <client>`.

## Layout

```
src/
  stdio.ts, http.ts       entry points
  app.ts                  express app: OAuth router, Google callback, POST /mcp
  server.ts               McpServer: tools, resources, prompts, instructions
  tools/                  define.ts (visibility, errors, logging) + one file per domain
  api/                    fetch client (X-Api-Key, X-Forwarded-For, {error,message} errors) + response types
  oauth/                  provider (bridge), store (SQLite), google, crypto
  catalog.ts              cached public plan catalog / commissions
  session.ts, context.ts  identity (/auth/me) and per-session context
  trim.ts, i18n.ts, ratelimit.ts, log.ts, config.ts
test/                     bun test with an in-process fake API
```

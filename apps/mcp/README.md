# apps/mcp: CEITBA MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants (Claude, ChatGPT,
Cursor, VS Code, Kiro, ...) access to CEITBA data through the API (`apps/api`). It can run in two ways:

| Mode | Entry | Auth | For |
|---|---|---|---|
| **Hosted**: Streamable HTTP at `https://ceitba.org.ar/mcp` | `src/http.ts` | OAuth 2.1 (sign in with the ITBA Google account); the only way in | Everyone: Claude.ai and ChatGPT connectors, and any client that supports remote servers |
| **Local**: stdio | `src/stdio.ts` | Optional `CEITBA_API_KEY` | Desktop clients, offline development |

User-facing setup guide (Spanish, then English): **[CONECTAR.md](CONECTAR.md)**.

Stack: Bun 1.4, TypeScript, `@modelcontextprotocol/sdk`, zod, express (from the SDK), `bun:sqlite`.
The schedule combiner comes from `packages/scheduler-core`, the same code the web scheduler (`apps/web/src/scheduler`) runs.

## Tools

The tools a session can list depend on who is signed in and on the credential's scopes. Tools a session can't use are
hidden (`src/tools/define.ts` `isVisible`). Descriptions are written in Spanish first, then English. Output is compact
JSON with trimmed fields, short times (`Lun 08:00-10:00 SDF 101`), and long text split into pages with `offset`.

| Access | Tools |
|---|---|
| Public | `list_careers`, `get_plan_subjects`, `get_subject`, `get_subject_commissions`, `find_free_classrooms`, `check_classroom_conflicts`, `generate_schedules`, `get_share_session`, `list_articles`, `get_article`, `list_events`, `list_organizations`, `get_organization`, `list_benefits`, `list_staff_members`, `list_highlights` |
| Signed in | `whoami`, `list_my_schedules`, `list_my_follows`, `get_digest_subscription`, `list_my_schedule_corrections`, `list_study_groups`, `get_study_group`, `list_my_study_groups`, `list_proposals`, `get_proposal`, `list_my_bookmarks` |
| Signed in + `apuntes` capability | `search_apuntes`, `list_subject_files`, `get_subject_wiki`, `get_wiki_page`, `search_wiki` (semantic search over the wikis: passages with page, section and `ceitba://wiki/...` resource, for RAG) |
| **Reports**: signed in + `apuntes` + `report` scope | `report_wiki_page`, `report_apuntes_file` (one report per user; 3 reports hide the content until CEITBA reviews it) |
| Staff (`staff` scope) | `staff_list_schedule_corrections`, `staff_search_users`, `staff_list_digests`, `staff_analytics_summary` |
| Moderator or staff (`staff` scope) | `moderation_list_proposals` |
| **Writes**: staff/moderator + `write` scope | `staff_review_schedule_correction` (apply/reject), `moderation_review_proposal` (approve/reject) |

Students can read and report content, nothing else: their keys carry `["read", "report"]`, and the API's `report`
scope only opens the two report endpoints. Only staff and moderators get write tools, and those tools are marked
`destructiveHint`.

Resources: `ceitba://plan/{planId}` (a plan's subjects) and `ceitba://wiki/{subjectId}/{slug}` (a wiki page as
markdown, needs `apuntes`). Prompts: `planificar_cuatrimestre`, `estudiar_materia`, `que_hay_esta_semana`.

Never exposed: auth and token endpoints, `/sync/**`, the KB pipeline and model admin, mail, account deletion, devices
and push, analytics ingestion, uploads, Drive source management, role and capability grants, and article votes. Votes
are anonymous and deduplicated by IP, so every user of the hosted server would count as one voter.

## How auth works

**Scoped API keys (API side).** User API keys carry scopes (`apps/api/docs/AUTH-SETUP.md` § Scopes):

- `read`: GET only.
- `report`: also the two report endpoints (wiki pages, Apuntes files); implied by `write`.
- `write`: non-safe methods.
- `staff`: keeps STAFF/MODERATOR and every staff power services check; without it a staff member's key acts as a student's.

A scoped key cannot mint keys, but can revoke itself. The owner must still pass the email allowlist.

**OAuth bridge (hosted mode).** This server is its own OAuth 2.1 authorization server, with issuer
`https://ceitba.org.ar/mcp`. The SDK's handlers provide metadata, dynamic client registration, PKCE, token and
revoke. `src/oauth/provider.ts` does the CEITBA part:

1. The MCP client calls `/mcp/authorize`. We store the request (10 min), set an HttpOnly `SameSite=Lax` cookie that
   binds it to this browser, and show a consent page with the client's name and where it will send the user back
   (`src/oauth/consent.ts`). Approving it (`POST /mcp/oauth/consent`, cookie required) redirects to Google; declining
   sends `access_denied` to the client.
2. Google redirects to `/mcp/oauth/google/callback` (only an approved request, in the browser holding its cookie),
   and we exchange the code for an ID token. Without the consent page and the cookie, anyone could register a client
   and send a student an authorize link that ends with the code, and a CEITBA API key, at their own redirect URI.
3. `POST /api/v1/auth/google/mobile {idToken, nonce}`. The API verifies the token, the allowlist and the `hd` domain,
   then returns a short session.
4. With that session we create a **scoped API key**: `["read","report"]` for students, `["read","report","staff","write"]` for staff and
   moderators (narrowed further if the client asked for fewer scopes). Then we log the session out.
5. We store the grant and its authorization code in one transaction; if that fails, the new API key is revoked.
   Then we issue our own opaque access token (1 h) and refresh token (rotating, lives as long as the grant, 90 days
   by default) to the MCP client. A refresh token presented by another client is rejected without consuming it.

**Storage.** Only the encrypted API key is stored (AES-256-GCM, `MCP_ENCRYPTION_KEY`). Tokens are stored as SHA-256
hashes in SQLite (`MCP_DB_PATH`).

**Revocation and cleanup:**

- Revoking a refresh token, or the API rejecting the key, deletes the grant and revokes the API key.
- A periodic sweep removes expired grants and abandoned logins.

The API's JWT secret never leaves the API, and the API remains the only judge of who can sign in.

**Capability.** Connecting needs the `asistentes_ia` capability (`apps/api/docs/CAPABILITIES.md`; staff hold all).
The bridge refuses the sign-in without it (`access_denied`), and every MCP request re-checks it through `/auth/me`: once
it's gone, the sign-in is revoked and the client gets `401`. Turn it on for everyone or grant it per user/org from the
staff Capabilities page.

**OAuth only.** The hosted server accepts only its own access tokens. A raw `ceitba_` API key sent as the bearer token
gets `401`, so clients must support OAuth. Users see and disconnect their sign-ins on the web app's `/ia` page.
Only the local stdio mode (developers) uses an API key, `CEITBA_API_KEY`.

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

**Hosted mode locally** needs a Google OAuth client with redirect URI `http://localhost:8787/mcp/oauth/google/callback`.
Its client id must be in the API's `AUTH_GOOGLE_MOBILE_AUDIENCES`.

```sh
cp .env.example .env    # set CEITBA_API_URL=http://localhost:8080/api, MCP_PUBLIC_URL=http://localhost:8787/mcp
bun --env-file=.env src/http.ts
```

## Deploy

CI (`ci.yml`, job `mcp-test`) typechecks, tests and builds the image. On `main`, `deploy.yml` runs `mcp-test`, then
`mcp-image` (pushes `ghcr.io/ceitba/ceitba-mcp`), then `mcp-deploy` (copies `docker-compose.yml` to `~/CEITBA-MCP`, then
pulls and starts the container). It runs after the API deploy.

**Routing.** The server shares `ceitba.org.ar` with the main site; no extra DNS name or certificate is needed. Caddy
(`infra/caddy/Caddyfile`) forwards only these paths to `ceitba-mcp:8787`, without stripping the prefix:

| Path | What |
|---|---|
| `/mcp`, `/mcp/*` | MCP endpoint, OAuth endpoints (`/mcp/authorize`, `/mcp/token`, `/mcp/register`, `/mcp/revoke`), consent form (`/mcp/oauth/consent`), Google callback, `/mcp/healthz` |
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 resource metadata (the 401 `WWW-Authenticate` points here) |
| `/.well-known/oauth-authorization-server/mcp`, `/.well-known/openid-configuration/mcp` | RFC 8414 metadata for issuer `https://ceitba.org.ar/mcp` |

Everything else, including `/authorize` and the root `/.well-known/*`, stays with the main site. The issuer has a
path, so the SDK's `mcpAuthRouter` is not used: it always mounts the OAuth endpoints at the origin root. `src/app.ts`
mounts the SDK's individual handlers under the base path instead. Changing `MCP_PUBLIC_URL`'s path means changing the
Caddy matcher and the Google redirect URI too.

One-time setup:

1. **Google Cloud Console.** Use a new OAuth web client (recommended) or the existing one. Add the authorized redirect
   URI `https://ceitba.org.ar/mcp/oauth/google/callback`.
2. **API.** Add that client id to `AUTH_GOOGLE_MOBILE_AUDIENCES` in `~/CEITBA-API/.env` (comma separated), and deploy
   the API first, since V62 adds key scopes.
3. **VPS.** Run `mkdir ~/CEITBA-MCP`, then create `~/CEITBA-MCP/.env` from [.env.example](.env.example)
   (`MCP_ENCRYPTION_KEY=$(openssl rand -base64 32)`, plus the Google client id and secret). Back up
   `MCP_ENCRYPTION_KEY`: losing it invalidates every MCP sign-in, and users only need to connect again.

The SQLite store lives in the `mcp_data` volume. Deleting it signs everyone out of MCP. The API keys it held expire on
their own, and users can disconnect them on the `/ia` page; they are named `MCP · <client>`.

## Layout

```
src/
  stdio.ts, http.ts       entry points
  app.ts                  express app under the /mcp base path: OAuth handlers, Google callback, POST /mcp
  server.ts               McpServer: tools, resources, prompts, instructions
  tools/                  define.ts (visibility, errors, logging) + one file per domain
  api/                    fetch client (X-Api-Key, X-Forwarded-For, {error,message} errors) + response types
  oauth/                  provider (bridge), consent (page + browser binding), store (SQLite), google, crypto
  catalog.ts              cached public plan catalog / commissions (plan ids checked against /v1/careers/plans)
  session.ts, context.ts  identity (/auth/me) and per-session context
  trim.ts, i18n.ts, ratelimit.ts, log.ts, config.ts
test/                     bun test with an in-process fake API
```

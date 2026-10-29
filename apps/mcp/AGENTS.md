# apps/mcp: agent rules

Read `README.md` here first (dev, ops, OAuth bridge). Users connect from the web app's `/ia` page (`apps/web/src/pages/AiConnectPage.tsx`,
where opening `/mcp` in a browser lands); `CONECTAR.md` is the same guide as Markdown.

- Tools live in `src/tools/*` and are declared with `defineTool` (access: public, user, staff or moderator; plus
  `write`, `report`, `events` and `capability`). Sessions only list the tools they can use. Students read, report and
  create events for their own organizations: `write` tools must be staff or moderator tools, and `report` tools and
  `create_event` (`events` scope, which opens only `POST /v1/news/events`) are the only changes a student session makes.
- Descriptions are Spanish first, then `EN:`. Return compact, trimmed JSON (`src/trim.ts`), never raw API payloads.
- Hosted mode is stateless Streamable HTTP and acts as its own OAuth 2.1 server. It bridges Google sign-in through
  `POST /v1/auth/google/mobile` and stores only an encrypted, scoped API key per login (`src/oauth/provider.ts`).
  Every authorization goes through the consent page (`src/oauth/consent.ts`), bound to the browser that started it.
  Connecting needs the `asistentes_ia` capability (`MCP_CAPABILITY`), checked at sign-in and on every request.
- The schedule generator comes from `@ceitba/scheduler-core` (`packages/scheduler-core`), the same code the web
  scheduler runs. Change it there, never copy it.
- Tests: `bun test` (from `apps/mcp`) runs against an in-process fake API (`test/fakeApi.ts`) and a fake Google.

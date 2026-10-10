# apps/mcp: agent rules

Read `README.md` here first (dev, ops, OAuth bridge); `CONECTAR.md` is the connection guide for students.

- Tools live in `src/tools/*` and are declared with `defineTool` (access: public, user, staff or moderator; plus
  `write` and `capability`). Sessions only list the tools they can use. Students are read-only: `write` tools must
  be staff or moderator tools.
- Descriptions are Spanish first, then `EN:`. Return compact, trimmed JSON (`src/trim.ts`), never raw API payloads.
- Hosted mode is stateless Streamable HTTP and acts as its own OAuth 2.1 server. It bridges Google sign-in through
  `POST /v1/auth/google/mobile` and stores only an encrypted, scoped API key per login (`src/oauth/provider.ts`).
  Every authorization goes through the consent page (`src/oauth/consent.ts`), bound to the browser that started it.
- The schedule generator comes from `@ceitba/scheduler-core` (`packages/scheduler-core`), the same code the web
  scheduler runs. Change it there, never copy it.
- Tests: `bun test` (from `apps/mcp`) runs against an in-process fake API (`test/fakeApi.ts`) and a fake Google.

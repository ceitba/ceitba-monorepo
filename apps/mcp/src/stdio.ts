#!/usr/bin/env bun
// Local MCP server over stdio, for Claude Desktop, Claude Code, Cursor, VS Code,
// Kiro... Runs on the user's machine and talks to the public CEITBA API.
//
//   CEITBA_API_KEY=ceitba_... bun apps/mcp/src/stdio.ts
//
// Without CEITBA_API_KEY only the public tools are listed. Create a key at
// POST /api/v1/auth/api-keys with scopes ["read"] (see apps/mcp/README.md).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CeitbaApi } from "./api/client";
import { stdioConfig } from "./config";
import { ALL_SCOPES, parseScopes, type SessionContext } from "./context";
import { createLogger } from "./log";
import { RateLimiter } from "./ratelimit";
import { createCeitbaServer } from "./server";
import { resolveIdentity } from "./session";

async function main() {
  const cfg = stdioConfig();
  const log = createLogger(cfg.logLevel);
  const api = new CeitbaApi({
    baseUrl: cfg.apiUrl,
    apiKey: cfg.apiKey || undefined,
    userAgent: `ceitba-mcp/${cfg.version} (stdio)`
  });

  let identity = null;
  try {
    identity = await resolveIdentity(api, cfg.defaultLang);
  } catch (e) {
    log.error("CEITBA_API_KEY was rejected by the API; continuing with public tools only",
      { error: e instanceof Error ? e.message : String(e) });
  }

  // The key's real scopes are enforced by the API; locally we assume what the
  // user opted into so the right tools are listed.
  const scopes = parseScopes(cfg.allowWrites ? ALL_SCOPES : ["read", "staff"]);
  const ctx: SessionContext = {
    api: identity ? api : api.withCredentials({}),
    identity,
    scopes,
    allowWrites: cfg.allowWrites,
    lang: identity?.lang ?? cfg.defaultLang,
    log,
    limiter: new RateLimiter(cfg.rateLimitPerMinute),
    client: "stdio"
  };

  const { server, tools } = createCeitbaServer(ctx, cfg.version);
  await server.connect(new StdioServerTransport());
  log.info("ceitba-mcp stdio ready", { apiUrl: cfg.apiUrl, userId: identity?.id ?? null, tools: tools.length });
}

main().catch(e => {
  process.stderr.write(`ceitba-mcp: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});

import type { Express, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CeitbaApi } from "./api/client";
import type { HttpConfig } from "./config";
import { parseScopes, type SessionContext } from "./context";
import type { Logger } from "./log";
import { sha256hex } from "./oauth/crypto";
import { CeitbaOAuthProvider, SUPPORTED_SCOPES } from "./oauth/provider";
import type { RateLimiter } from "./ratelimit";
import { createCeitbaServer } from "./server";
import { IdentityCache, isAuthRejection, resolveIdentity } from "./session";

// Express app for the hosted server (Streamable HTTP, stateless: one MCP
// server instance per request, built for the caller's identity and scopes).
//
//   POST /mcp                                     MCP endpoint (Bearer token)
//   /.well-known/oauth-protected-resource/mcp     RFC 9728 metadata
//   /.well-known/oauth-authorization-server       RFC 8414 metadata
//   /authorize /token /register /revoke           OAuth 2.1 (PKCE, DCR) via the SDK
//   /oauth/google/callback                        Google → us (bridge step)
//   /healthz                                      liveness

export interface AppDeps {
  cfg: HttpConfig;
  api: CeitbaApi;
  provider: CeitbaOAuthProvider;
  log: Logger;
  limiter: RateLimiter;
  identities?: IdentityCache;
}

export function createApp({ cfg, api, provider, log, limiter, identities = new IdentityCache() }: AppDeps): Express {
  const app = createMcpExpressApp({ host: cfg.host, allowedHosts: cfg.allowedHosts });
  app.set("trust proxy", cfg.trustProxy);
  app.disable("x-powered-by");

  const issuer = new URL(cfg.publicUrl);
  const resourceUrl = new URL("/mcp", cfg.publicUrl);
  const docsUrl = new URL("https://github.com/ceitba/ceitba-monorepo/tree/main/apps/mcp");

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", version: cfg.version });
  });

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: issuer,
    resourceServerUrl: resourceUrl,
    serviceDocumentationUrl: docsUrl,
    scopesSupported: SUPPORTED_SCOPES,
    resourceName: "CEITBA"
  }));

  app.get("/oauth/google/callback", (req, res) => {
    provider.handleGoogleCallback(req, res).catch(e => {
      log.error("google callback crashed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) res.status(500).type("text/plain").send("Error interno");
    });
  });

  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      `CEITBA MCP server\n\nMCP endpoint: ${resourceUrl.href}\nGuía / guide: ${docsUrl.href}\n`);
  });

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
    expectedResource: resourceUrl
  });

  const unauthorized = (res: Response, msg: string) => {
    res.set("WWW-Authenticate",
      `Bearer error="invalid_token", error_description="${msg}", resource_metadata="${getOAuthProtectedResourceMetadataUrl(resourceUrl)}"`);
    res.status(401).json({ error: "invalid_token", error_description: msg });
  };

  app.post("/mcp", bearer, async (req: Request, res: Response) => {
    let cred;
    try {
      cred = provider.resolve(req.auth!);
    } catch {
      unauthorized(res, "The sign-in was revoked");
      return;
    }
    const userApi = api.withForwardedFor(req.ip).withCredentials({ apiKey: cred.apiKey });
    const cacheKey = sha256hex(cred.apiKey);
    let identity;
    try {
      identity = await identities.get(cacheKey, () => resolveIdentity(userApi, cfg.defaultLang));
    } catch (e) {
      if (isAuthRejection(e)) {
        // The API no longer accepts the key (revoked, expired, user removed from the allowlist).
        identities.delete(cacheKey);
        if (cred.grantId) await provider.revokeGrant(cred.grantId);
        unauthorized(res, "CEITBA rejected this sign-in; connect again");
        return;
      }
      log.error("identity lookup failed", { error: e instanceof Error ? e.message : String(e) });
      res.status(502).json({ jsonrpc: "2.0", error: { code: -32603, message: "CEITBA API unavailable" }, id: null });
      return;
    }

    const ctx: SessionContext = {
      api: userApi,
      identity,
      scopes: parseScopes(cred.scopes),
      allowWrites: true,
      lang: identity?.lang ?? cfg.defaultLang,
      log,
      limiter,
      client: req.auth!.clientId
    };

    const { server } = createCeitbaServer(ctx, cfg.version);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      log.error("mcp request failed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // Stateless server: no SSE stream to resume and no session to delete.
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  return app;
}

import express, { type Express, type Request, type Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthMetadata, OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CeitbaApi } from "./api/client";
import type { HttpConfig } from "./config";
import { MCP_CAPABILITY, parseScopes, type SessionContext } from "./context";
import type { Logger } from "./log";
import { sha256hex } from "./oauth/crypto";
import { CeitbaOAuthProvider, SUPPORTED_SCOPES } from "./oauth/provider";
import type { RateLimiter } from "./ratelimit";
import { createCeitbaServer } from "./server";
import { IdentityCache, isAuthRejection, resolveIdentity } from "./session";

// Express app for the hosted server (Streamable HTTP, stateless: one MCP
// server instance per request, built for the caller's identity and scopes).
//
// Everything lives under the path of MCP_PUBLIC_URL (production:
// https://ceitba.org.ar/mcp, shared with the main site), so the reverse proxy
// only forwards that prefix plus the path-suffixed /.well-known documents.
// With base = /mcp:
//
//   POST /mcp                                               MCP endpoint (Bearer token)
//   /.well-known/oauth-protected-resource/mcp               RFC 9728 metadata
//   /.well-known/oauth-authorization-server/mcp             RFC 8414 metadata (issuer has a path)
//   /.well-known/openid-configuration/mcp,
//   /mcp/.well-known/{openid-configuration,oauth-authorization-server}
//                                                           same metadata, for clients that try those
//   /mcp/authorize /mcp/token /mcp/register /mcp/revoke     OAuth 2.1 (PKCE, DCR) handlers from the SDK
//   /mcp/oauth/consent                                      consent form POST (oauth/consent.ts)
//   /mcp/oauth/google/callback                              Google → us (bridge step)
//   /healthz, /mcp/healthz                                  liveness
//
// The SDK's mcpAuthRouter is not used because it always mounts the OAuth
// endpoints at the origin root ("/authorize"...), which belongs to the main site.

export interface AppDeps {
  cfg: HttpConfig;
  api: CeitbaApi;
  provider: CeitbaOAuthProvider;
  log: Logger;
  limiter: RateLimiter;
  identities?: IdentityCache;
}

export function oauthMetadata(publicUrl: string, docsUrl: URL): OAuthMetadata {
  return {
    issuer: publicUrl,
    service_documentation: docsUrl.href,
    authorization_endpoint: `${publicUrl}/authorize`,
    token_endpoint: `${publicUrl}/token`,
    registration_endpoint: `${publicUrl}/register`,
    revocation_endpoint: `${publicUrl}/revoke`,
    revocation_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: SUPPORTED_SCOPES
  };
}

export function createApp({ cfg, api, provider, log, limiter, identities = new IdentityCache() }: AppDeps): Express {
  const app = createMcpExpressApp({ host: cfg.host, allowedHosts: cfg.allowedHosts });
  app.set("trust proxy", cfg.trustProxy);
  app.disable("x-powered-by");

  const resourceUrl = new URL(cfg.publicUrl);
  const base = resourceUrl.pathname; // e.g. "/mcp"
  // The connect page of the web app (apps/web /ia), on the same origin.
  const docsUrl = new URL("/ia", resourceUrl);

  const health = (_req: Request, res: Response) => {
    res.json({ status: "ok", version: cfg.version });
  };
  app.get("/healthz", health);
  app.get(`${base}/healthz`, health);

  // Discovery documents.
  const asMetadata = oauthMetadata(cfg.publicUrl, docsUrl);
  const prm: OAuthProtectedResourceMetadata = {
    resource: cfg.publicUrl,
    authorization_servers: [cfg.publicUrl],
    scopes_supported: SUPPORTED_SCOPES,
    resource_name: "CEITBA",
    resource_documentation: docsUrl.href
  };
  app.use(`/.well-known/oauth-protected-resource${base}`, metadataHandler(prm));
  for (const path of [
    `/.well-known/oauth-authorization-server${base}`,
    `/.well-known/openid-configuration${base}`,
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`
  ]) {
    app.use(path, metadataHandler(asMetadata));
  }

  // OAuth endpoints (the SDK handlers: validation, PKCE, rate limits, DCR).
  app.use(`${base}/authorize`, authorizationHandler({ provider }));
  app.use(`${base}/token`, tokenHandler({ provider }));
  app.use(`${base}/register`, clientRegistrationHandler({ clientsStore: provider.clientsStore }));
  app.use(`${base}/revoke`, revocationHandler({ provider }));

  app.post(`${base}/oauth/consent`, express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    provider.handleConsent(req, res).catch(e => {
      log.error("oauth consent crashed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) res.status(500).type("text/plain").send("Error interno");
    });
  });

  app.get(`${base}/oauth/google/callback`, (req, res) => {
    provider.handleGoogleCallback(req, res).catch(e => {
      log.error("google callback crashed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) res.status(500).type("text/plain").send("Error interno");
    });
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

  app.post(base, bearer, async (req: Request, res: Response) => {
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
        await provider.revokeGrant(cred.grantId);
        unauthorized(res, "CEITBA rejected this sign-in; connect again");
        return;
      }
      log.error("identity lookup failed", { error: e instanceof Error ? e.message : String(e) });
      res.status(502).json({ jsonrpc: "2.0", error: { code: -32603, message: "CEITBA API unavailable" }, id: null });
      return;
    }
    if (!identity?.capabilities.includes(MCP_CAPABILITY)) {
      // The asistentes_ia capability was taken away: end the sign-in. Signing in
      // again explains why it is refused.
      identities.delete(cacheKey);
      await provider.revokeGrant(cred.grantId);
      unauthorized(res, "AI assistants are not enabled for this CEITBA account");
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
  // A browser opening the URL is sent to the connect page instead.
  const notAllowed = (req: Request, res: Response) => {
    if (req.method === "GET" && req.accepts(["text/html", "application/json"]) === "text/html") {
      res.redirect(302, docsUrl.href);
      return;
    }
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get(base, notAllowed);
  app.delete(base, notAllowed);

  return app;
}

import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTargetError,
  InvalidTokenError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ApiError, type CeitbaApi } from "../api/client";
import type { ApiKeyCreated, TokenResponse, UserMe } from "../api/types";
import type { Scope } from "../context";
import type { Logger } from "../log";
import { randomToken, SecretBox, sha256hex } from "./crypto";
import type { GoogleClient } from "./google";
import type { Grant, OAuthStore } from "./store";

// OAuth 2.1 authorization server for MCP clients (PKCE + dynamic client
// registration are handled by the SDK's mcpAuthRouter; this is the logic).
//
// The bridge, per login:
//   1. MCP client → /authorize → we remember the request and send the user to Google.
//   2. Google → /oauth/google/callback with a code → we get the ID token.
//   3. POST /api/v1/auth/google/mobile {idToken, nonce}: the API verifies it and
//      the allowlist and returns a short-lived session for that user.
//   4. With that session we mint a SCOPED API key (read; + staff, write for staff),
//      then log the session out. Only the encrypted key is kept (grants table).
//   5. We issue our own opaque access/refresh tokens to the MCP client, mapped to the grant.
// The CEITBA JWT secret never leaves the API, and the API stays the only judge
// of who may sign in and what a key can do.

export const SUPPORTED_SCOPES: Scope[] = ["read", "staff", "write"];

export interface ProviderOptions {
  store: OAuthStore;
  api: CeitbaApi;
  google: GoogleClient;
  box: SecretBox;
  log: Logger;
  // Canonical MCP resource URL (e.g. https://ceitba.org.ar/mcp).
  resourceUrl: URL;
  accessTokenTtlSeconds: number;
  grantTtlDays: number;
  allowApiKeyBearer: boolean;
  // Client IP for API calls made during the Google callback.
  clientIp?: (req: Request) => string | undefined;
}

// What a verified access token resolves to.
export interface ResolvedCredential {
  apiKey: string;
  scopes: Scope[];
  grantId: string | null;
}

const PENDING_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const MAX_CLIENTS = 10_000;

// Scopes a user may hold: students are read-only; staff and moderators may
// also get "staff" and "write". Requested scopes narrow that further.
export function decideScopes(requested: string[] | undefined, me: Pick<UserMe, "role" | "moderator">): Scope[] {
  const privileged = me.role === "staff" || Boolean(me.moderator);
  const allowed: Scope[] = privileged ? ["read", "staff", "write"] : ["read"];
  const asked = (requested ?? []).map(s => s.replace(/^ceitba[.:]/, "")).filter((s): s is Scope => SUPPORTED_SCOPES.includes(s as Scope));
  const chosen = asked.length === 0 ? allowed : allowed.filter(s => asked.includes(s));
  return Array.from(new Set<Scope>(["read", ...chosen]));
}

export class CeitbaOAuthProvider implements OAuthServerProvider {
  constructor(private readonly o: ProviderOptions) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    const store = this.o.store;
    return {
      getClient: id => store.getClient(id),
      registerClient: client => {
        if (store.countClients() >= MAX_CLIENTS) throw new InvalidRequestError("Client registration is temporarily closed");
        const full = client as OAuthClientInformationFull;
        store.saveClient(full);
        return full;
      }
    };
  }

  private checkResource(resource?: URL): void {
    if (!resource) return;
    const norm = (u: URL | string) => String(u).replace(/#.*$/, "").replace(/\/$/, "");
    if (norm(resource) !== norm(this.o.resourceUrl)) {
      throw new InvalidTargetError(`This server only issues tokens for ${this.o.resourceUrl.href}`);
    }
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    try {
      this.checkResource(params.resource);
    } catch (e) {
      const u = new URL(params.redirectUri);
      u.searchParams.set("error", "invalid_target");
      u.searchParams.set("error_description", (e as Error).message);
      if (params.state) u.searchParams.set("state", params.state);
      res.redirect(302, u.href);
      return;
    }
    const pendingId = randomToken("", 24);
    const nonce = randomToken("", 16);
    this.o.store.savePending({
      id: pendingId,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      scopes: params.scopes ?? [],
      resource: params.resource?.href ?? null,
      nonce,
      expiresAt: Date.now() + PENDING_TTL_MS
    });
    res.redirect(302, this.o.google.authorizationUrl(pendingId, nonce));
  }

  // GET /oauth/google/callback?code&state (Google redirects the browser here).
  async handleGoogleCallback(req: Request, res: Response): Promise<void> {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const pending = state ? this.o.store.takePending(state) : undefined;
    if (!pending) {
      res.status(400).type("text/plain").send("La solicitud de inicio de sesión expiró o no es válida. Volvé a conectar desde tu cliente MCP.");
      return;
    }
    const back = (params: Record<string, string>) => {
      const u = new URL(pending.redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (pending.state) u.searchParams.set("state", pending.state);
      res.redirect(302, u.href);
    };
    if (typeof req.query.error === "string") {
      back({ error: "access_denied", error_description: "Google sign-in was cancelled" });
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      back({ error: "invalid_request", error_description: "Missing Google authorization code" });
      return;
    }

    const client = this.o.store.getClient(pending.clientId);
    const ip = this.o.clientIp?.(req);
    try {
      const idToken = await this.o.google.exchangeCode(code);
      const grant = await this.bridge(idToken, pending.nonce, pending.scopes, client?.client_name ?? pending.clientId, ip);
      grant.clientId = pending.clientId;
      this.o.store.saveGrant(grant);
      const authCode = randomToken("mcp_ac_");
      this.o.store.saveCode({
        codeHash: sha256hex(authCode),
        grantId: grant.id,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        resource: pending.resource,
        expiresAt: Date.now() + CODE_TTL_MS
      });
      this.o.log.info("oauth login", { event: "oauth_login", userId: grant.userId, client: pending.clientId, scopes: grant.scopes });
      back({ code: authCode });
    } catch (e) {
      const denied = e instanceof ApiError && (e.status === 401 || e.status === 403);
      this.o.log.warn("oauth login failed", {
        event: "oauth_login", client: pending.clientId, status: "error",
        error: e instanceof ApiError ? `${e.status} ${e.code}` : e instanceof Error ? e.message : String(e)
      });
      back(denied
        ? { error: "access_denied", error_description: "This Google account is not allowed to use CEITBA (use your @itba.edu.ar account)" }
        : { error: "server_error", error_description: "Could not complete the CEITBA sign-in" });
    }
  }

  // Steps 3-4 of the bridge. Returns the grant (not yet saved). Exposed for tests.
  async bridge(idToken: string, nonce: string | undefined, requestedScopes: string[], clientName: string, ip?: string) {
    const base = this.o.api.withForwardedFor(ip);
    const api = base.withCredentials({});
    const session = await api.send<TokenResponse>("POST", "/v1/auth/google/mobile",
      { idToken, nonce, deviceName: "CEITBA MCP" });
    const scopes = decideScopes(requestedScopes, session.user);
    const asUser = base.withCredentials({ bearer: session.accessToken });
    let key: ApiKeyCreated;
    try {
      key = await asUser.send<ApiKeyCreated>("POST", "/v1/auth/api-keys", {
        name: `MCP · ${clientName}`.slice(0, 120),
        ttlDays: this.o.grantTtlDays,
        scopes
      });
    } finally {
      // The mobile-style session was only needed to mint the key.
      await api.send("POST", "/v1/auth/logout", { refreshToken: session.refreshToken }).catch(() => undefined);
    }
    const id = randomToken("g_", 16);
    const grant: Grant = {
      id,
      clientId: "",
      userId: session.user.id,
      scopes,
      apiKeySealed: this.o.box.seal(key.key, id),
      apiKeyId: key.id,
      createdAt: Date.now(),
      expiresAt: Math.min(Date.parse(key.expiresAt) || Infinity, Date.now() + this.o.grantTtlDays * 86_400_000)
    };
    return grant;
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = this.o.store.getCode(sha256hex(authorizationCode));
    if (!code || code.expiresAt < Date.now()) throw new InvalidGrantError("Invalid or expired authorization code");
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const code = this.o.store.takeCode(sha256hex(authorizationCode));
    if (!code || code.expiresAt < Date.now()) throw new InvalidGrantError("Invalid or expired authorization code");
    if (code.clientId !== client.client_id) throw new InvalidGrantError("Authorization code was issued to another client");
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) throw new InvalidGrantError("redirect_uri mismatch");
    this.checkResource(resource);
    return this.issueTokens(code.grantId, client.client_id);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, _scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    this.checkResource(resource);
    const row = this.o.store.takeToken(sha256hex(refreshToken));
    if (!row || row.kind !== "refresh" || row.expiresAt < Date.now()) throw new InvalidGrantError("Invalid or expired refresh token");
    if (row.clientId !== client.client_id) throw new InvalidGrantError("Refresh token was issued to another client");
    if (!this.o.store.getGrant(row.grantId)) throw new InvalidGrantError("The sign-in was revoked");
    return this.issueTokens(row.grantId, client.client_id);
  }

  // Persists a grant produced by bridge() for a client (called on code creation).
  private issueTokens(grantId: string, clientId: string): OAuthTokens {
    const grant = this.o.store.getGrant(grantId);
    if (!grant) throw new InvalidGrantError("The sign-in was revoked");
    const access = randomToken("mcp_at_");
    const refresh = randomToken("mcp_rt_");
    const accessExp = Math.min(grant.expiresAt, Date.now() + this.o.accessTokenTtlSeconds * 1000);
    this.o.store.saveToken({ tokenHash: sha256hex(access), kind: "access", grantId, clientId, expiresAt: accessExp });
    this.o.store.saveToken({ tokenHash: sha256hex(refresh), kind: "refresh", grantId, clientId, expiresAt: grant.expiresAt });
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: Math.max(1, Math.floor((accessExp - Date.now()) / 1000)),
      refresh_token: refresh,
      scope: grant.scopes.join(" ")
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token.startsWith("ceitba_")) {
      if (!this.o.allowApiKeyBearer) throw new InvalidTokenError("API keys are not accepted as bearer tokens here");
      // Raw user API key (clients without OAuth). The API validates it on every
      // call and enforces its real scopes; tools are listed for all three.
      return {
        token, clientId: "api-key", scopes: [...SUPPORTED_SCOPES],
        expiresAt: Math.floor(Date.now() / 1000) + 3600, resource: this.o.resourceUrl,
        extra: { apiKey: token, grantId: null }
      };
    }
    const row = this.o.store.getToken(sha256hex(token));
    if (!row || row.kind !== "access" || row.expiresAt < Date.now()) throw new InvalidTokenError("Invalid or expired access token");
    const grant = this.o.store.getGrant(row.grantId);
    if (!grant) throw new InvalidTokenError("The sign-in was revoked");
    return {
      token, clientId: row.clientId, scopes: grant.scopes,
      expiresAt: Math.floor(row.expiresAt / 1000), resource: this.o.resourceUrl,
      extra: { grantId: grant.id, userId: grant.userId }
    };
  }

  // The CEITBA API key behind a verified token.
  resolve(auth: AuthInfo): ResolvedCredential {
    const extra = (auth.extra ?? {}) as { apiKey?: string; grantId?: string | null };
    if (extra.apiKey) return { apiKey: extra.apiKey, scopes: auth.scopes as Scope[], grantId: null };
    const grant = extra.grantId ? this.o.store.getGrant(extra.grantId) : undefined;
    if (!grant) throw new InvalidTokenError("The sign-in was revoked");
    return { apiKey: this.o.box.open(grant.apiKeySealed, grant.id), scopes: grant.scopes as Scope[], grantId: grant.id };
  }

  // Revoking a refresh token ends the whole sign-in: tokens, grant and the CEITBA API key.
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const row = this.o.store.getToken(sha256hex(request.token));
    if (!row || row.clientId !== client.client_id) return;
    if (row.kind === "access") {
      this.o.store.deleteToken(row.tokenHash);
      return;
    }
    await this.revokeGrant(row.grantId);
  }

  async revokeGrant(grantId: string): Promise<void> {
    const grant = this.o.store.getGrant(grantId);
    if (!grant) return;
    this.o.store.deleteGrant(grantId);
    await this.revokeApiKey(grant);
  }

  // A key may always delete itself (ApiKeyFilter), even when read-only.
  async revokeApiKey(grant: { id: string; apiKeySealed: string; apiKeyId: string; userId: string }): Promise<void> {
    try {
      const key = this.o.box.open(grant.apiKeySealed, grant.id);
      await this.o.api.withCredentials({ apiKey: key }).send("DELETE", `/v1/auth/api-keys/${grant.apiKeyId}`);
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 404))) {
        this.o.log.warn("could not revoke CEITBA API key", { userId: grant.userId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Periodic cleanup: drops expired rows and revokes keys of expired grants.
  async sweep(): Promise<void> {
    for (const g of this.o.store.sweep()) await this.revokeApiKey(g);
  }
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { CeitbaApi } from "../src/api/client";
import { createApp } from "../src/app";
import type { HttpConfig } from "../src/config";
import { silentLogger } from "../src/log";
import { SecretBox } from "../src/oauth/crypto";
import { CeitbaOAuthProvider, decideScopes } from "../src/oauth/provider";
import { OAuthStore } from "../src/oauth/store";
import { RateLimiter } from "../src/ratelimit";
import { CATALOG, error, ME_STAFF, ME_STUDENT, startFakeApi, type FakeApi } from "./fakeApi";

let api: FakeApi;
let server: Server;
let base: string;
let store: OAuthStore;
let provider: CeitbaOAuthProvider;
const keys = new Map<string, { me: typeof ME_STUDENT; scopes: string[]; id: string }>();
const deletedKeys: string[] = [];

const freePort = () => {
  const s = Bun.serve({ port: 0, fetch: () => new Response() });
  const p = s.port as number;
  s.stop(true);
  return p;
};

beforeAll(async () => {
  api = startFakeApi({
    "POST /v1/auth/google/mobile": req => {
      const { idToken } = req.body as { idToken: string };
      if (idToken === "id-token-outsider") return error(403, "LoginRejected");
      const user = idToken === "id-token-staff" ? ME_STAFF : ME_STUDENT;
      return { accessToken: `jwt-${user.id}`, accessTokenExpiresAt: "", refreshToken: `rt-${user.id}`, refreshTokenExpiresAt: "", user };
    },
    "POST /v1/auth/api-keys": req => {
      const auth = req.headers.get("authorization") ?? "";
      const me = auth === `Bearer jwt-${ME_STAFF.id}` ? ME_STAFF : auth === `Bearer jwt-${ME_STUDENT.id}` ? ME_STUDENT : null;
      if (!me) return error(401, "invalid_token");
      const body = req.body as { scopes: string[]; ttlDays: number };
      const id = crypto.randomUUID();
      const key = `ceitba_${randomBytes(8).toString("hex")}`;
      keys.set(key, { me, scopes: body.scopes, id });
      return { id, name: "x", key, expiresAt: new Date(Date.now() + body.ttlDays * 86_400_000).toISOString(), scopes: body.scopes };
    },
    "POST /v1/auth/logout": () => undefined,
    "GET /v1/auth/me": req => {
      const k = keys.get(req.headers.get("x-api-key") ?? "");
      return k ? { ...k.me, apiKeyScopes: k.scopes } : error(401, "invalid_token");
    },
    "DELETE /v1/auth/api-keys/:id": req => {
      const id = req.path.split("/").pop()!;
      deletedKeys.push(id);
      for (const [k, v] of keys) if (v.id === id) keys.delete(k);
      return undefined;
    },
    "GET /v1/careers/plans": () => ({ S: { id: "S", name: "Informática", plans: ["S10-Rev23"] } }),
    "GET /v1/subjects": () => CATALOG
  });

  const port = freePort();
  base = `http://localhost:${port}`;
  const cfg: HttpConfig = {
    apiUrl: api.url, defaultLang: "es", rateLimitPerMinute: 0, logLevel: "error", version: "test",
    port, host: "127.0.0.1", publicUrl: `${base}/mcp`, dbPath: ":memory:", encryptionKey: randomBytes(32).toString("base64"),
    googleClientId: "g", googleClientSecret: "s", googleHostedDomain: "itba.edu.ar", trustProxy: 1,
    accessTokenTtlSeconds: 3600, grantTtlDays: 30, allowedHosts: ["localhost", "127.0.0.1"]
  };
  store = new OAuthStore(":memory:");
  const ceitba = new CeitbaApi({ baseUrl: api.url });
  provider = new CeitbaOAuthProvider({
    store, api: ceitba, box: new SecretBox(cfg.encryptionKey), log: silentLogger,
    google: {
      authorizationUrl: (state, nonce) => `https://google.test/auth?state=${state}&nonce=${nonce}`,
      exchangeCode: async code => `id-token-${code}`
    },
    resourceUrl: new URL(`${base}/mcp`), accessTokenTtlSeconds: 3600, grantTtlDays: 30
  });
  const app = createApp({ cfg, api: ceitba, provider, log: silentLogger, limiter: new RateLimiter(0) });
  await new Promise<void>(r => { server = app.listen(port, "127.0.0.1", () => r()); });
});

afterAll(() => {
  server?.close();
  api.stop();
  store.close();
});

const rpc = (token: string | null, method: string, params: Record<string, unknown> = {}) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });

const initParams = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } };

async function register() {
  const reg = await fetch(`${base}/mcp/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Test client", redirect_uris: ["http://localhost:9999/cb"], token_endpoint_auth_method: "none" })
  });
  expect(reg.status).toBe(201);
  return (await reg.json()) as { client_id: string };
}

// GET /authorize: the consent page plus the browser-binding cookie.
async function startAuthorize(clientId: string, challenge: string, scope?: string) {
  const authorize = new URL(`${base}/mcp/authorize`);
  Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: "http://localhost:9999/cb",
    code_challenge: challenge, code_challenge_method: "S256", state: "st4te", resource: `${base}/mcp`,
    ...(scope ? { scope } : {})
  }).forEach(([k, v]) => authorize.searchParams.set(k, v));
  const a = await fetch(authorize, { redirect: "manual" });
  expect(a.status).toBe(200);
  const html = await a.text();
  const pending = /name="pending" value="([^"]+)"/.exec(html)![1];
  const setCookie = a.headers.get("set-cookie")!;
  const cookie = setCookie.split(";")[0];
  return { a, html, pending, cookie, setCookie };
}

const consent = (pending: string, decision: string, cookie?: string) =>
  fetch(`${base}/mcp/oauth/consent`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams({ pending, decision })
  });

const callback = (code: string, state: string, cookie?: string) =>
  fetch(`${base}/mcp/oauth/google/callback?code=${code}&state=${state}`, {
    redirect: "manual", headers: cookie ? { Cookie: cookie } : {}
  });

async function login(googleCode: string, scope?: string) {
  const client = await register();

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const { pending, cookie } = await startAuthorize(client.client_id, challenge, scope);
  const ok = await consent(pending, "allow", cookie);
  expect(ok.status).toBe(303);
  const google = new URL(ok.headers.get("location")!);
  expect(google.host).toBe("google.test");

  const cb = await callback(googleCode, google.searchParams.get("state")!, cookie);
  expect(cb.status).toBe(302);
  const back = new URL(cb.headers.get("location")!);
  expect(back.searchParams.get("state")).toBe("st4te");
  return { client, verifier, back };
}

async function token(params: Record<string, string>) {
  const res = await fetch(`${base}/mcp/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  return { status: res.status, body: (await res.json()) as Record<string, string | number> };
}

describe("discovery", () => {
  test("protected resource and authorization server metadata", async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json() as Record<string, unknown>;
    expect(prm.resource).toBe(`${base}/mcp`);
    expect(prm.authorization_servers).toEqual([`${base}/mcp`]);
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server/mcp`)).json() as Record<string, unknown>;
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${base}/mcp/register`);
  });

  test("every endpoint and alternate discovery path lives under /mcp; nothing at the site root", async () => {
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server/mcp`)).json() as Record<string, string>;
    expect(as.issuer).toBe(`${base}/mcp`);
    for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
      expect(as[k]).toStartWith(`${base}/mcp/`);
    }
    for (const p of ["/.well-known/openid-configuration/mcp", "/mcp/.well-known/oauth-authorization-server", "/mcp/.well-known/openid-configuration"]) {
      expect(((await (await fetch(base + p)).json()) as Record<string, string>).issuer).toBe(`${base}/mcp`);
    }
    // Paths the main site owns are not answered by this server.
    for (const p of ["/authorize", "/token", "/register", "/.well-known/oauth-authorization-server", "/oauth/google/callback"]) {
      expect((await fetch(base + p, { redirect: "manual" })).status).toBe(404);
    }
  });

  test("a browser opening /mcp is sent to the connect page", async () => {
    const res = await fetch(`${base}/mcp`, { headers: { Accept: "text/html" }, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${base}/ia`);
    expect((await fetch(`${base}/mcp`, { headers: { Accept: "application/json" } })).status).toBe(405);
  });

  test("unauthenticated MCP calls get 401 pointing at the metadata", async () => {
    const res = await rpc(null, "initialize", initParams);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
});

describe("OAuth bridge", () => {
  test("decideScopes: students are read-only, staff get what they ask for", () => {
    expect(decideScopes(undefined, { role: "user", moderator: false })).toEqual(["read", "report"]);
    expect(decideScopes(["read", "staff", "write"], { role: "user", moderator: false })).toEqual(["read"]);
    expect(decideScopes(undefined, { role: "staff", moderator: true })).toEqual(["read", "report", "staff", "write"]);
    expect(decideScopes(["read", "staff"], { role: "staff", moderator: true })).toEqual(["read", "staff"]);
  });

  test("full flow: login, MCP calls, refresh rotation, revoke", async () => {
    const { client, verifier, back } = await login("student");
    const code = back.searchParams.get("code")!;
    expect(code).toStartWith("mcp_ac_");

    // The API session was closed and a read-only key minted.
    expect(api.calls.some(c => c.path === "/v1/auth/logout")).toBe(true);
    const minted = api.calls.findLast(c => c.path === "/v1/auth/api-keys")!;
    expect((minted.body as { scopes: string[] }).scopes).toEqual(["read", "report"]);

    const t1 = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://localhost:9999/cb" });
    expect(t1.status).toBe(200);
    expect(t1.body.scope).toBe("read report");
    // Codes are single use.
    const again = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id });
    expect(again.status).toBe(400);

    const access = String(t1.body.access_token);
    const init = await rpc(access, "initialize", initParams);
    expect(init.status).toBe(200);
    const list = await (await rpc(access, "tools/list")).json() as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map(t => t.name);
    expect(names).toContain("whoami");
    expect(names.some(n => n.startsWith("staff_"))).toBe(false);

    const call = await (await rpc(access, "tools/call", { name: "list_careers", arguments: {} })).json() as { result: { content: { text: string }[] } };
    expect(JSON.parse(call.result.content[0].text)[0].plans).toEqual(["S10-Rev23"]);
    // The user's key (not the OAuth token) is what reaches the API.
    const careersCall = api.calls.findLast(c => c.path === "/v1/careers/plans")!;
    expect(careersCall.headers.get("x-api-key")).toStartWith("ceitba_");
    expect(careersCall.headers.get("authorization")).toBeNull();
    // The end user's IP is forwarded so the API's per-IP limits stay per user.
    expect(careersCall.headers.get("x-forwarded-for")).toBeTruthy();

    const refresh1 = String(t1.body.refresh_token);
    const t2 = await token({ grant_type: "refresh_token", refresh_token: refresh1, client_id: client.client_id });
    expect(t2.status).toBe(200);
    const reuse = await token({ grant_type: "refresh_token", refresh_token: refresh1, client_id: client.client_id });
    expect(reuse.status).toBe(400);

    const rev = await fetch(`${base}/mcp/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: String(t2.body.refresh_token), client_id: client.client_id })
    });
    expect(rev.status).toBe(200);
    expect(deletedKeys.length).toBe(1);
    expect((await rpc(String(t2.body.access_token), "tools/list")).status).toBe(401);
  });

  test("staff get staff + write tools", async () => {
    const { client, verifier, back } = await login("staff");
    const t = await token({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: verifier, client_id: client.client_id });
    expect(t.body.scope).toBe("read report staff write");
    const list = await (await rpc(String(t.body.access_token), "tools/list")).json() as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map(x => x.name)).toContain("staff_review_schedule_correction");
  });

  test("authorize shows a consent page naming the client and where it sends the user back", async () => {
    const client = await register();
    const { a, html, setCookie } = await startAuthorize(client.client_id, "x".repeat(43));
    expect(a.headers.get("content-type")).toContain("text/html");
    expect(a.headers.get("x-frame-options")).toBe("DENY");
    expect(a.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("Test client");
    expect(html).toContain("localhost:9999");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/mcp");
  });

  test("the flow only completes in the browser that started it", async () => {
    const client = await register();
    const { pending, cookie } = await startAuthorize(client.client_id, "x".repeat(43));
    const mintedBefore = api.calls.filter(c => c.path === "/v1/auth/api-keys").length;
    // Someone else's browser (no cookie, or a wrong one) can't approve...
    expect((await consent(pending, "allow")).status).toBe(400);
    expect((await consent(pending, "allow", `mcp_oauth_${pending}=forged`)).status).toBe(400);
    // ...nor skip the consent page straight to the Google callback.
    expect((await callback("student", pending)).status).toBe(400);
    expect((await callback("student", pending, cookie)).status).toBe(400); // not approved yet
    expect(api.calls.filter(c => c.path === "/v1/auth/api-keys").length).toBe(mintedBefore);
  });

  test("an approved request still needs the cookie at the Google callback", async () => {
    const client = await register();
    const { pending, cookie } = await startAuthorize(client.client_id, "x".repeat(43));
    expect((await consent(pending, "allow", cookie)).status).toBe(303);
    expect((await callback("student", pending)).status).toBe(400);
  });

  test("declining the consent page sends access_denied back to the client", async () => {
    const client = await register();
    const { pending, cookie } = await startAuthorize(client.client_id, "x".repeat(43));
    const res = await consent(pending, "deny", cookie);
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("location")!);
    expect(back.origin).toBe("http://localhost:9999");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("st4te");
    // The request is gone.
    expect((await consent(pending, "allow", cookie)).status).toBe(400);
  });

  test("a refresh token presented by another client stays usable by its owner", async () => {
    const { client, verifier, back } = await login("student");
    const t = await token({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: verifier, client_id: client.client_id });
    const other = await register();
    const stolen = await token({ grant_type: "refresh_token", refresh_token: String(t.body.refresh_token), client_id: other.client_id });
    expect(stolen.status).toBe(400);
    const own = await token({ grant_type: "refresh_token", refresh_token: String(t.body.refresh_token), client_id: client.client_id });
    expect(own.status).toBe(200);
  });

  test("if the grant can't be stored, the freshly minted API key is revoked", async () => {
    const original = store.saveGrantWithCode.bind(store);
    store.saveGrantWithCode = () => { throw new Error("SQLITE_BUSY"); };
    try {
      const before = deletedKeys.length;
      const { back } = await login("student");
      expect(back.searchParams.get("error")).toBe("server_error");
      expect(deletedKeys.length).toBe(before + 1);
      const minted = api.calls.findLast(c => c.path === "/v1/auth/api-keys" && c.method === "POST")!;
      expect(minted).toBeTruthy();
    } finally {
      store.saveGrantWithCode = original;
    }
  });

  test("accounts the API rejects come back as access_denied", async () => {
    const { back } = await login("outsider");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });

  test("a raw ceitba_ API key is not a bearer token: OAuth is the only way in", async () => {
    const key = "ceitba_rawkey";
    keys.set(key, { me: ME_STUDENT, scopes: ["read"], id: crypto.randomUUID() });
    const res = await rpc(key, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  test("when the API stops accepting a sign-in's key, the client gets 401 and the sign-in is dropped", async () => {
    const { client, verifier, back } = await login("student");
    const t = await token({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: verifier, client_id: client.client_id });
    const minted = api.calls.findLast(c => c.path === "/v1/auth/api-keys" && c.method === "POST")!;
    // Revoked on the API side (e.g. from the /ia page, or the user left the allowlist).
    for (const [k, v] of keys) if (v.me.id === ME_STUDENT.id && JSON.stringify(v.scopes) === JSON.stringify((minted.body as { scopes: string[] }).scopes)) keys.delete(k);
    expect((await rpc(String(t.body.access_token), "tools/list")).status).toBe(401);
    const refresh = await token({ grant_type: "refresh_token", refresh_token: String(t.body.refresh_token), client_id: client.client_id });
    expect(refresh.status).toBe(400);
  });
});

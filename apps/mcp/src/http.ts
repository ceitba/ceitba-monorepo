// Hosted MCP server (Streamable HTTP + OAuth 2.1), e.g. https://ceitba.org.ar/mcp.
// Configuration: apps/mcp/.env.example. Deployment: apps/mcp/README.md.
import { CeitbaApi } from "./api/client";
import { httpConfig, requireHttpSecrets } from "./config";
import { createApp } from "./app";
import { createLogger } from "./log";
import { SecretBox } from "./oauth/crypto";
import { googleClient } from "./oauth/google";
import { CeitbaOAuthProvider } from "./oauth/provider";
import { OAuthStore } from "./oauth/store";
import { RateLimiter } from "./ratelimit";

const cfg = httpConfig();
requireHttpSecrets(cfg);
const log = createLogger(cfg.logLevel);

const api = new CeitbaApi({ baseUrl: cfg.apiUrl, userAgent: `ceitba-mcp/${cfg.version} (http)` });
const store = new OAuthStore(cfg.dbPath);
const provider = new CeitbaOAuthProvider({
  store,
  api,
  google: googleClient({
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    redirectUri: `${cfg.publicUrl}/oauth/google/callback`,
    hostedDomain: cfg.googleHostedDomain || undefined
  }),
  box: new SecretBox(cfg.encryptionKey),
  log,
  resourceUrl: new URL(cfg.publicUrl),
  accessTokenTtlSeconds: cfg.accessTokenTtlSeconds,
  grantTtlDays: cfg.grantTtlDays,
  allowApiKeyBearer: cfg.allowApiKeyBearer,
  clientIp: req => req.ip
});

const app = createApp({ cfg, api, provider, log, limiter: new RateLimiter(cfg.rateLimitPerMinute) });

const sweep = () => provider.sweep().catch(e => log.warn("sweep failed", { error: e instanceof Error ? e.message : String(e) }));
void sweep();
const timer = setInterval(sweep, 10 * 60_000);

const server = app.listen(cfg.port, cfg.host, () => {
  log.info("ceitba-mcp http ready", { port: cfg.port, publicUrl: cfg.publicUrl, apiUrl: cfg.apiUrl });
});

const shutdown = () => {
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

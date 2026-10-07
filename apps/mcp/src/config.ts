// Environment configuration. Every value has a safe default for local use
// except the HTTP/OAuth secrets, which http.ts requires explicitly.

export type Lang = "es" | "en";

const str = (name: string, fallback = ""): string => {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
};

const int = (name: string, fallback: number): number => {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
};

const lang = (raw: string): Lang => (raw.toLowerCase().startsWith("en") ? "en" : "es");

export interface CommonConfig {
  // API base URL including the /api context path, without a trailing slash.
  apiUrl: string;
  defaultLang: Lang;
  // Tool calls per user per minute (0 = unlimited).
  rateLimitPerMinute: number;
  logLevel: "debug" | "info" | "warn" | "error";
  version: string;
}

export interface StdioConfig extends CommonConfig {
  apiKey: string;
  // Staff write tools are opt-in on stdio (the API still enforces the key's scopes).
  allowWrites: boolean;
}

export interface HttpConfig extends CommonConfig {
  port: number;
  host: string;
  // Public origin of this server, e.g. https://mcp.ceitba.org.ar (no trailing slash).
  publicUrl: string;
  dbPath: string;
  // base64, 32 bytes: AES-256-GCM key for the API keys stored per grant.
  encryptionKey: string;
  googleClientId: string;
  googleClientSecret: string;
  // Google "hd" hint shown on the account chooser (the API enforces the allowlist).
  googleHostedDomain: string;
  // Express "trust proxy" setting: how many proxy hops (Caddy) to trust.
  trustProxy: number;
  accessTokenTtlSeconds: number;
  // Lifetime of the scoped API key (and of the grant/refresh token) per login.
  grantTtlDays: number;
  // Accept a raw ceitba_ API key as the bearer token (clients without OAuth).
  allowApiKeyBearer: boolean;
  allowedHosts: string[];
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function commonConfig(): CommonConfig {
  const level = str("LOG_LEVEL", "info") as CommonConfig["logLevel"];
  return {
    apiUrl: trimSlash(str("CEITBA_API_URL", "https://ceitba.org.ar/api")),
    defaultLang: lang(str("CEITBA_MCP_LANG", "es")),
    rateLimitPerMinute: int("MCP_RATE_LIMIT_PER_MINUTE", 60),
    logLevel: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
    version: "0.1.0"
  };
}

export function stdioConfig(): StdioConfig {
  return {
    ...commonConfig(),
    apiKey: str("CEITBA_API_KEY"),
    allowWrites: bool("CEITBA_MCP_ALLOW_WRITES", false)
  };
}

export function httpConfig(): HttpConfig {
  const publicUrl = trimSlash(str("MCP_PUBLIC_URL", "http://localhost:8787"));
  const cfg: HttpConfig = {
    ...commonConfig(),
    port: int("PORT", 8787),
    host: str("HOST", "0.0.0.0"),
    publicUrl,
    dbPath: str("MCP_DB_PATH", "./data/mcp.sqlite"),
    encryptionKey: str("MCP_ENCRYPTION_KEY"),
    googleClientId: str("GOOGLE_CLIENT_ID"),
    googleClientSecret: str("GOOGLE_CLIENT_SECRET"),
    googleHostedDomain: str("GOOGLE_HOSTED_DOMAIN", "itba.edu.ar"),
    trustProxy: int("MCP_TRUST_PROXY_HOPS", 1),
    accessTokenTtlSeconds: int("MCP_ACCESS_TOKEN_TTL_SECONDS", 3600),
    grantTtlDays: Math.min(365, Math.max(1, int("MCP_GRANT_TTL_DAYS", 90))),
    allowApiKeyBearer: bool("MCP_ALLOW_API_KEY_BEARER", true),
    // Loopback names are always allowed (container healthcheck, local dev);
    // DNS rebinding sends the attacker's hostname, never these.
    allowedHosts: [...new Set([
      ...str("MCP_ALLOWED_HOSTS", new URL(publicUrl).hostname).split(",").map(h => h.trim()).filter(Boolean),
      "127.0.0.1", "localhost"
    ])]
  };
  return cfg;
}

export function requireHttpSecrets(cfg: HttpConfig): void {
  const missing: string[] = [];
  if (!cfg.encryptionKey) missing.push("MCP_ENCRYPTION_KEY");
  if (!cfg.googleClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!cfg.googleClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")} (see apps/mcp/.env.example)`);
  }
  if (Buffer.from(cfg.encryptionKey, "base64").length !== 32) {
    throw new Error("MCP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
  }
  if (!cfg.publicUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.publicUrl)) {
    throw new Error("MCP_PUBLIC_URL must be https:// (http is only allowed for localhost)");
  }
}

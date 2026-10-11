import type { CeitbaApi } from "./api/client";
import type { UserMe } from "./api/types";
import type { Lang } from "./config";
import { langFrom } from "./i18n";
import type { Logger } from "./log";
import type { RateLimiter } from "./ratelimit";

// Scopes of the credential behind a session. They mirror the API key scopes
// (ApiKeyScope.java): read is always present, report allows reporting wiki
// pages and Apuntes files, write allows every non-safe method (and implies
// report), staff keeps the owner's STAFF/MODERATOR roles.
export type Scope = "read" | "report" | "write" | "staff";

// CEITBA capability (apps/api/docs/CAPABILITIES.md) a user needs to connect an
// assistant to the hosted server. Staff hold every capability.
export const MCP_CAPABILITY = "asistentes_ia";
export const ALL_SCOPES: Scope[] = ["read", "report", "write", "staff"];

export interface Identity {
  id: string;
  name: string;
  email: string;
  staff: boolean;
  moderator: boolean;
  capabilities: string[];
  careerId: string | null;
  plan: string | null;
  lang: Lang;
  // The API key's real scopes as the API reports them (null: not a key, or an
  // older API that doesn't say).
  apiKeyScopes: Scope[] | null;
}

// Everything a tool call needs; built once per MCP session (stdio) or per
// HTTP request (stateless Streamable HTTP).
export interface SessionContext {
  api: CeitbaApi;
  identity: Identity | null;
  scopes: Set<Scope>;
  // Staff write tools are listed only when this is true AND the scopes allow it.
  allowWrites: boolean;
  lang: Lang;
  log: Logger;
  limiter: RateLimiter;
  // OAuth client id or "stdio", for logs.
  client: string;
}

export function identityFrom(me: UserMe, fallbackLang: Lang): Identity {
  return {
    id: me.id,
    name: me.name,
    email: me.email,
    staff: me.role === "staff",
    moderator: me.role === "staff" || Boolean(me.moderator),
    capabilities: me.capabilities ?? [],
    careerId: me.careerId ?? null,
    plan: me.plan ?? null,
    lang: langFrom(me.language, fallbackLang),
    apiKeyScopes: me.apiKeyScopes ? [...parseScopes(me.apiKeyScopes)] : null
  };
}

export function parseScopes(raw: Iterable<string>): Set<Scope> {
  const out = new Set<Scope>(["read"]);
  for (const s of raw) {
    const k = s.replace(/^ceitba[.:]/, "") as Scope;
    if (ALL_SCOPES.includes(k)) out.add(k);
  }
  if (out.has("write")) out.add("report");
  return out;
}

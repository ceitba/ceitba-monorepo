import type { CeitbaApi } from "./api/client";
import type { UserMe } from "./api/types";
import type { Lang } from "./config";
import { langFrom } from "./i18n";
import type { Logger } from "./log";
import type { RateLimiter } from "./ratelimit";

// Scopes of the credential behind a session. They mirror the API key scopes
// (ApiKeyScope.java): read is always present, write allows non-safe methods,
// staff keeps the owner's STAFF/MODERATOR roles.
export type Scope = "read" | "write" | "staff";
export const ALL_SCOPES: Scope[] = ["read", "write", "staff"];

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
  // OAuth client id or "stdio"/"api-key", for logs.
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
    lang: langFrom(me.language, fallbackLang)
  };
}

export function parseScopes(raw: Iterable<string>): Set<Scope> {
  const out = new Set<Scope>(["read"]);
  for (const s of raw) {
    const k = s.replace(/^ceitba[.:]/, "") as Scope;
    if (ALL_SCOPES.includes(k)) out.add(k);
  }
  return out;
}

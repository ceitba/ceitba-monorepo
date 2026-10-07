import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CeitbaApi } from "../src/api/client";
import { identityFrom, parseScopes, type Scope, type SessionContext } from "../src/context";
import { silentLogger } from "../src/log";
import { RateLimiter } from "../src/ratelimit";
import { createCeitbaServer } from "../src/server";

export interface SessionOptions {
  apiUrl: string;
  me?: Parameters<typeof identityFrom>[0] | null;
  scopes?: Scope[];
  allowWrites?: boolean;
  perMinute?: number;
}

export function makeContext(o: SessionOptions): SessionContext {
  const identity = o.me ? identityFrom(o.me, "es") : null;
  return {
    api: new CeitbaApi({ baseUrl: o.apiUrl, apiKey: identity ? "ceitba_test" : undefined }),
    identity,
    scopes: parseScopes(o.scopes ?? ["read"]),
    allowWrites: o.allowWrites ?? false,
    lang: identity?.lang ?? "es",
    log: silentLogger,
    limiter: new RateLimiter(o.perMinute ?? 0),
    client: "test"
  };
}

export async function connect(o: SessionOptions) {
  const { server, tools } = createCeitbaServer(makeContext(o));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    tools,
    async call(name: string, args: Record<string, unknown> = {}) {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* plain text error */ }
      return { isError: Boolean(res.isError), data, text };
    },
    close: () => client.close()
  };
}

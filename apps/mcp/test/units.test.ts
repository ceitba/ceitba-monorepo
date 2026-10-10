import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { CeitbaApi } from "../src/api/client";
import { CatalogCache, UnknownPlanError } from "../src/catalog";
import { normalizePublicUrl } from "../src/config";
import { parseScopes } from "../src/context";
import { createLogger } from "../src/log";
import { SecretBox } from "../src/oauth/crypto";
import { OAuthStore } from "../src/oauth/store";
import { RateLimiter } from "../src/ratelimit";
import { todayInArgentina } from "../src/tools/news";
import { compact, cut, slot } from "../src/trim";

describe("CatalogCache", () => {
  test("rejects made-up plans without fetching them, and caps the cache", async () => {
    const plans = Array.from({ length: 5 }, (_, i) => `P${i}`);
    const fetched: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/api/v1/careers/plans") return Response.json({ X: { id: "X", name: "X", plans } });
        fetched.push(u.searchParams.get("plan") ?? "");
        return Response.json({});
      }
    });
    try {
      const api = new CeitbaApi({ baseUrl: `http://localhost:${server.port}/api` });
      const cache = new CatalogCache(60_000, Date.now, 2);
      for (const bogus of ["nope", "../x", "P99"]) {
        await expect(cache.planSubjects(api, bogus)).rejects.toBeInstanceOf(UnknownPlanError);
      }
      expect(fetched).toEqual([]);
      for (const p of plans) await cache.planSubjects(api, p);
      expect(fetched).toEqual(plans);
      // Only the 2 most recently used plans stay cached.
      await cache.planSubjects(api, "P4");
      await cache.planSubjects(api, "P0");
      expect(fetched).toEqual([...plans, "P0"]);
    } finally {
      server.stop(true);
    }
  });
});

describe("SecretBox", () => {
  test("round trips and binds the AAD", () => {
    const box = new SecretBox(randomBytes(32).toString("base64"));
    const sealed = box.seal("ceitba_secret", "g_1");
    expect(sealed).not.toContain("ceitba_secret");
    expect(box.open(sealed, "g_1")).toBe("ceitba_secret");
    expect(() => box.open(sealed, "g_2")).toThrow();
  });
});

describe("OAuthStore.sweep", () => {
  test("drops expired grants and grants abandoned before getting a token", () => {
    const s = new OAuthStore(":memory:");
    const t0 = Date.now();
    const grant = (id: string, createdAt: number, expiresAt: number) =>
      s.saveGrant({ id, clientId: "c", userId: "u", scopes: ["read"], apiKeySealed: "x", apiKeyId: id, createdAt, expiresAt });
    grant("expired", t0 - 1000, t0 - 1);
    grant("orphan", t0 - 60 * 60_000, t0 + 86_400_000);
    grant("live", t0 - 60 * 60_000, t0 + 86_400_000);
    s.saveToken({ tokenHash: "h", kind: "refresh", grantId: "live", clientId: "c", expiresAt: t0 + 86_400_000 });
    grant("fresh", t0, t0 + 86_400_000);
    expect(s.sweep(t0).map(g => g.id).sort()).toEqual(["expired", "orphan"]);
    expect(s.getGrant("live")).toBeDefined();
    expect(s.getGrant("fresh")).toBeDefined();
    s.close();
  });
});

describe("helpers", () => {
  test("MCP_PUBLIC_URL defaults to the /mcp path and keeps an explicit one", () => {
    expect(normalizePublicUrl("https://ceitba.org.ar")).toBe("https://ceitba.org.ar/mcp");
    expect(normalizePublicUrl("https://ceitba.org.ar/")).toBe("https://ceitba.org.ar/mcp");
    expect(normalizePublicUrl("https://ceitba.org.ar/mcp/")).toBe("https://ceitba.org.ar/mcp");
    expect(normalizePublicUrl("http://localhost:8787/x/mcp")).toBe("http://localhost:8787/x/mcp");
    expect(() => normalizePublicUrl("https://ceitba.org.ar/mcp?x=1")).toThrow();
  });
  test("scopes always include read and ignore unknown values", () => {
    expect([...parseScopes(["ceitba.staff", "admin"])].sort()).toEqual(["read", "staff"]);
  });

  test("rate limiter refills over time", () => {
    let now = 0;
    const rl = new RateLimiter(2, () => now);
    expect(rl.take("u")).toBe(true);
    expect(rl.take("u")).toBe(true);
    expect(rl.take("u")).toBe(false);
    expect(rl.take("other")).toBe(true);
    now += 30_000;
    expect(rl.take("u")).toBe(true);
  });

  test("trim helpers", () => {
    expect(slot({ day: "WEDNESDAY", time_from: "18:00:00", time_to: "21:00:00", building: null, classroom: null })).toBe("Mié 18:00-21:00");
    expect(compact<unknown>({ a: 1, b: null, c: [], d: "", e: { f: undefined, g: 0 } })).toEqual({ a: 1, e: { g: 0 } });
    expect(cut("abcdef", 4, 2)).toEqual({ text: "cdef", truncated: false, totalChars: 6, offset: 2 });
    expect(todayInArgentina(new Date("2026-10-08T02:00:00Z"))).toBe("2026-10-07");
  });

  test("logs go to the sink as JSON and respect the level", () => {
    const lines: string[] = [];
    const log = createLogger("info", l => lines.push(l));
    log.debug("hidden");
    log.info("tool call", { tool: "x", userId: "u" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "info", msg: "tool call", tool: "x", userId: "u" });
  });
});

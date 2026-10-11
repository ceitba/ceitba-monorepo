import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiError } from "../api/client";
import { UnknownPlanError } from "../catalog";
import type { SessionContext } from "../context";
import { t } from "../i18n";

// Who may see a tool. Tools a session can't use are not listed at all, so
// the model only ever sees what will actually work for this user.
//   public     anyone (also anonymous stdio sessions)
//   user       any signed-in user
//   staff      active CEITBA staff, credential with the "staff" scope
//   moderator  staff or proposal moderators, credential with the "staff" scope
export type Access = "public" | "user" | "staff" | "moderator";

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  // Spanish first, then English (CEITBA's primary audience is Spanish-speaking).
  description: string;
  access: Access;
  // Non-safe call (POST/PUT/PATCH/DELETE). Needs the "write" scope and an
  // explicit opt-in (allowWrites). Only staff/moderator tools may write.
  write?: boolean;
  // Reports content (PUT .../report): needs the "report" scope (write implies
  // it), which students hold too. The only change a student's session can make.
  report?: boolean;
  // CEITBA capability required (e.g. "apuntes"), see apps/api/docs/CAPABILITIES.md.
  capability?: string;
  input: S;
  annotations?: ToolAnnotations;
  run(args: z.infer<z.ZodObject<S>>, ctx: SessionContext): Promise<unknown>;
}

export const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> => def;

export class ToolError extends Error {}

export function isVisible(def: ToolDef, ctx: SessionContext): boolean {
  const id = ctx.identity;
  if (def.write && (def.access === "public" || def.access === "user")) return false; // students only ever report (def.report)
  if (def.write && !(ctx.allowWrites && ctx.scopes.has("write"))) return false;
  if (def.report && !ctx.scopes.has("report")) return false;
  switch (def.access) {
    case "public":
      break;
    case "user":
      if (!id) return false;
      break;
    case "staff":
      if (!id?.staff || !ctx.scopes.has("staff")) return false;
      break;
    case "moderator":
      if (!(id?.staff || id?.moderator) || !ctx.scopes.has("staff")) return false;
      break;
  }
  if (def.capability && !(id?.staff || id?.capabilities.includes(def.capability))) return false;
  return true;
}

const json = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }]
});

const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

export function errorMessage(e: unknown, ctx: SessionContext, def?: ToolDef): string {
  const lang = ctx.lang;
  if (e instanceof ToolError) return e.message;
  if (e instanceof UnknownPlanError) return t(lang, "unknownPlan", { plan: e.plan });
  if (e instanceof ApiError) {
    if (e.status === 0) return t(lang, "unreachable");
    if (e.status === 401) return t(lang, "signInRequired");
    if (e.status === 403 && e.code === "CAPABILITY_REQUIRED") {
      return t(lang, "capabilityRequired", { capability: def?.capability ?? "apuntes" });
    }
    if (e.status === 403 && e.code === "INSUFFICIENT_SCOPE") return t(lang, "insufficientScope", { detail: e.message });
    if (e.status === 403) return t(lang, "forbidden");
    if (e.status === 404) return t(lang, "notFound", { detail: e.message });
    if (e.status === 429) return t(lang, "rateLimited");
    if (e.status === 501 && def?.name === "search_wiki") return t(lang, "wikiSearchUnavailable");
    if (e.status === 400) return t(lang, "validation", { detail: e.message });
    return t(lang, "upstream", { detail: `${e.status} ${e.code}` });
  }
  return t(lang, "upstream", { detail: "internal error" });
}

export function registerTools(server: McpServer, ctx: SessionContext, defs: ToolDef[]): string[] {
  const registered: string[] = [];
  for (const def of defs) {
    if (!isVisible(def, ctx)) continue;
    registered.push(def.name);
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: {
          title: def.title,
          readOnlyHint: !def.write && !def.report,
          openWorldHint: false,
          ...def.annotations
        }
      },
      (async (args: Record<string, unknown>) => {
        const started = Date.now();
        const userKey = ctx.identity?.id ?? `anon:${ctx.client}`;
        const base = { event: "tool_call", tool: def.name, userId: ctx.identity?.id ?? null, client: ctx.client };
        if (!ctx.limiter.take(userKey)) {
          ctx.log.warn("tool rate limited", { ...base, status: "rate_limited" });
          return fail(t(ctx.lang, "rateLimited"));
        }
        try {
          const out = await def.run(args as never, ctx);
          ctx.log.info("tool call", { ...base, status: "ok", durationMs: Date.now() - started });
          return json(out);
        } catch (e) {
          const apiStatus = e instanceof ApiError ? e.status : undefined;
          const level = e instanceof ApiError || e instanceof ToolError ? "info" : "error";
          ctx.log[level]("tool call", {
            ...base, status: "error", durationMs: Date.now() - started, apiStatus,
            error: e instanceof ApiError ? e.code : e instanceof Error ? e.message : String(e)
          });
          return fail(errorMessage(e, ctx, def));
        }
      }) as never
    );
  }
  return registered;
}

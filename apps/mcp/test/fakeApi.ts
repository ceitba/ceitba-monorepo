// In-process fake of the CEITBA API for tests (Bun.serve on a random port).
// Routes are "METHOD /path" (path without the /api prefix, query ignored).
import type { UserMe } from "../src/api/types";

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export type Handler = (req: FakeRequest) => unknown | Response | Promise<unknown | Response>;

export interface FakeApi {
  url: string; // base URL including /api
  calls: FakeRequest[];
  routes: Map<string, Handler>;
  stop(): void;
}

export const error = (status: number, code: string, message = code) =>
  new Response(JSON.stringify({ error: code, message, path: "", timestamp: new Date().toISOString() }), {
    status, headers: { "Content-Type": "application/json" }
  });

export function startFakeApi(routes: Record<string, Handler>): FakeApi {
  const map = new Map(Object.entries(routes));
  const calls: FakeRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(raw) {
      const u = new URL(raw.url);
      const path = u.pathname.replace(/^\/api/, "");
      const text = await raw.text();
      const req: FakeRequest = {
        method: raw.method, path, query: u.searchParams, headers: raw.headers,
        body: text ? JSON.parse(text) : undefined
      };
      calls.push(req);
      const handler = map.get(`${raw.method} ${path}`)
        ?? [...map.entries()].find(([k]) => {
          const [m, p] = k.split(" ");
          if (m !== raw.method || !p.includes(":")) return false;
          const re = new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+") + "$");
          return re.test(path);
        })?.[1];
      if (!handler) return error(404, "NotFound", `no fake route for ${raw.method} ${path}`);
      const out = await handler(req);
      if (out instanceof Response) return out;
      if (out === undefined) return new Response(null, { status: 204 });
      return Response.json(out);
    }
  });
  return { url: `http://localhost:${server.port}/api`, calls, routes: map, stop: () => server.stop(true) };
}

// A small plan: two subjects, each with two commissions.
export const CATALOG = {
  Obligatorias: {
    "1": {
      "1": [
        {
          section: "Obligatorias", subject_id: "93.41", name: "Física I", credits: 6, dependencies: [], credits_required: null,
          course_start: "2026-08-10", course_end: "2026-11-28",
          commissions: [
            { commission_id: "c1", name: "A", schedule: [{ day: "MONDAY", classroom: "101", building: "SDF", time_from: "08:00:00", time_to: "11:00:00" }] },
            { commission_id: "c2", name: "B", schedule: [{ day: "TUESDAY", classroom: "102", building: "SDF", time_from: "14:00:00", time_to: "17:00:00" }] }
          ]
        },
        {
          section: "Obligatorias", subject_id: "72.11", name: "Programación I", credits: 9, dependencies: ["93.41"], credits_required: null,
          course_start: "2026-08-10", course_end: "2026-11-28",
          commissions: [
            { commission_id: "c3", name: "S", schedule: [{ day: "MONDAY", classroom: "201", building: "R", time_from: "09:00:00", time_to: "12:00:00" }] },
            { commission_id: "c4", name: "T", schedule: [{ day: "WEDNESDAY", classroom: "202", building: "R", time_from: "09:00:00", time_to: "12:00:00" }] }
          ]
        }
      ]
    }
  }
};

export const ME_STUDENT: UserMe = {
  id: "u-1", name: "Ana", email: "ana@itba.edu.ar", role: "user", moderator: false, language: "es",
  careerId: "S", plan: "S10-Rev23", organizations: [], follows: [], capabilities: ["asistentes_ia"]
};

export const ME_STAFF: UserMe = { ...ME_STUDENT, id: "u-2", name: "Sol", email: "sol@itba.edu.ar", role: "staff", moderator: true, capabilities: ["apuntes", "asistentes_ia"] };

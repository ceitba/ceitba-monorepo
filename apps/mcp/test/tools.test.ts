import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CATALOG, error, ME_STAFF, ME_STUDENT, startFakeApi, type FakeApi } from "./fakeApi";
import { defaultEndTime, todayInArgentina } from "../src/tools/news";
import { connect } from "./helpers";

let api: FakeApi;

beforeAll(() => {
  api = startFakeApi({
    "GET /v1/careers/plans": () => ({ S: { id: "S", name: "Ingeniería en Informática", plans: ["S10-Rev23"] } }),
    "GET /v1/subjects": req => (req.query.get("plan") === "S10-Rev23" ? CATALOG : {}),
    "GET /v1/plans/:id/requirements": req => (req.path === "/v1/plans/S10-Rev23/requirements"
      ? [{ section: "Electivas Gestíon", credits: 18, year: 3, semester: 1 }, { section: "Electivas", credits: 27, year: 4, semester: 2 }] : []),
    "GET /v1/commissions": () => [{ id: "c1", subjectCode: "93.41", subjectName: "Física I", commissionName: "A", quota: 40, enrolledStudents: 39 }],
    "GET /v1/me/schedules/:id": () => ({
      id: "11111111-1111-4111-8111-111111111111", name: "Q2", careerId: "S", plan: "S10-Rev23", isPrimary: true,
      createdAt: "", updatedAt: "",
      payload: { version: 1, selectedCourses: [{ subject_id: "93.41", selectedCommissions: ["B"] }, { subject_id: "72.11", selectedCommissions: [] }],
        options: { allowOverlap: false }, blockedTimes: [] }
    }),
    "GET /v1/wiki/subjects/:id/kb": () => error(403, "CAPABILITY_REQUIRED"),
    "GET /v1/staff/schedule-corrections": () => ({ data: [], meta: { total: 0, page: 1, limit: 20 } }),
    "GET /v1/staff-members/years": () => [],
    "GET /v1/wiki/kb/search": req => ({
      query: req.query.get("q"),
      results: req.query.get("q") === "nada" ? [] : [{
        pageId: "22222222-2222-4222-8222-222222222222", subjectId: "93.41", slug: "cinematica", title: "Cinemática",
        heading: "Movimiento rectilíneo", anchor: "movimiento-rectilineo", content: "x(t) = x0 + v t", score: 0.83
      }]
    }),
    "PUT /v1/wiki/kb/pages/:id/report": () => undefined,
    "PUT /v1/wiki/files/:id/report": () => undefined,
    "POST /v1/news/events": req => {
      const b = req.body as Record<string, unknown>;
      return new Response(JSON.stringify({ ...b, id: "33333333-3333-4333-8333-333333333333", startTime: `${b.startTime}:00`, endTime: `${b.endTime}:00`,
        createdAt: "", coverImage: null, capacity: null, rsvpCount: 0 }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
  });
});

afterAll(() => api.stop());

describe("tool visibility", () => {
  test("anonymous sessions only see public tools", async () => {
    const s = await connect({ apiUrl: api.url });
    expect(s.tools).toContain("generate_schedules");
    expect(s.tools).toContain("list_careers");
    expect(s.tools).not.toContain("whoami");
    expect(s.tools.some(t => t.startsWith("staff_"))).toBe(false);
    await s.close();
  });

  test("students see user tools but no wiki without the apuntes capability, and no staff tools", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STUDENT, scopes: ["read", "staff", "write"], allowWrites: true });
    expect(s.tools).toContain("whoami");
    expect(s.tools).toContain("list_my_schedules");
    expect(s.tools).not.toContain("get_wiki_page");
    expect(s.tools.some(t => t.startsWith("staff_") || t.startsWith("moderation_"))).toBe(false);
    await s.close();
  });

  test("staff need the staff scope for staff tools and write scope + opt-in for writes", async () => {
    const readOnly = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read"] });
    expect(readOnly.tools.some(t => t.startsWith("staff_"))).toBe(false);
    expect(readOnly.tools).toContain("get_wiki_page");
    await readOnly.close();

    const staffRead = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff"], allowWrites: true });
    expect(staffRead.tools).toContain("staff_list_schedule_corrections");
    expect(staffRead.tools).not.toContain("staff_review_schedule_correction");
    await staffRead.close();

    const staffWrite = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: true });
    expect(staffWrite.tools).toContain("staff_review_schedule_correction");
    expect(staffWrite.tools).toContain("moderation_review_proposal");
    await staffWrite.close();

    const noOptIn = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: false });
    expect(noOptIn.tools).not.toContain("staff_review_schedule_correction");
    await noOptIn.close();
  });

  test("students with the report scope may report content, read-only sessions may not", async () => {
    const student = { ...ME_STUDENT, capabilities: ["apuntes"] };
    const reader = await connect({ apiUrl: api.url, me: student, scopes: ["read"] });
    expect(reader.tools).toContain("search_wiki");
    expect(reader.tools).not.toContain("report_wiki_page");
    await reader.close();

    const reporter = await connect({ apiUrl: api.url, me: student, scopes: ["read", "report"] });
    expect(reporter.tools).toContain("report_wiki_page");
    expect(reporter.tools).toContain("report_apuntes_file");
    // Reporting does not open any other write.
    expect(reporter.tools.some(t => t.startsWith("staff_") || t.startsWith("moderation_"))).toBe(false);
    await reporter.close();
  });

  test("create_event is listed for staff and organization members holding the events scope, after the write opt-in", async () => {
    const member = { ...ME_STUDENT, organizations: [{ slug: "sabf", role: "member" }] };
    const cases: [Parameters<typeof connect>[0], boolean][] = [
      [{ me: member, scopes: ["read", "report", "events"], allowWrites: true }, true],
      [{ me: member, scopes: ["read", "report", "events"] }, false],
      [{ me: member, scopes: ["read", "report"], allowWrites: true }, false],
      [{ me: ME_STUDENT, scopes: ["read", "report", "events"], allowWrites: true }, false],
      [{ me: ME_STAFF, scopes: ["read", "events", "staff"], allowWrites: true }, true],
      [{ me: ME_STAFF, scopes: ["read", "events"], allowWrites: true }, false],
      [{ me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: true }, true],
      [{ me: null, scopes: ["read", "events"], allowWrites: true }, false]
    ].map(([o, v]) => [{ apiUrl: api.url, ...(o as object) }, v as boolean]);
    for (const [o, visible] of cases) {
      const s = await connect(o);
      expect(s.tools.includes("create_event")).toBe(visible);
      await s.close();
    }
  });

  test("every tool description is Spanish first with an English part", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: true });
    const { tools } = await s.client.listTools();
    for (const t of tools) {
      expect(t.description).toContain("EN:");
      expect(t.annotations?.readOnlyHint).toBe(!t.name.includes("review") && !t.name.startsWith("report_") && t.name !== "create_event");
    }
    await s.close();
  });
});

describe("tool calls", () => {
  test("get_plan_subjects flattens and filters the catalog", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("get_plan_subjects", { plan: "S10-Rev23", query: "fisica", includeCommissions: true });
    expect(r.isError).toBe(false);
    const data = r.data as { total: number; subjects: { id: string; commissions: { slots: string[] }[] }[] };
    expect(data.total).toBe(1);
    expect(data.subjects[0].id).toBe("93.41");
    expect(data.subjects[0].commissions[0].slots[0]).toBe("Lun 08:00-11:00 SDF 101");
    await s.close();
  });

  test("get_plan_subjects adds the elective-group credits, filtered like the subjects", async () => {
    const s = await connect({ apiUrl: api.url });
    const all = await s.call("get_plan_subjects", { plan: "S10-Rev23" });
    expect((all.data as { requirements: unknown[] }).requirements).toEqual([
      { section: "Electivas Gestíon", credits: 18, year: 3, semester: 1 }, { section: "Electivas", credits: 27, year: 4, semester: 2 }]);
    const y4 = await s.call("get_plan_subjects", { plan: "S10-Rev23", year: 4 });
    expect((y4.data as { requirements: unknown[] }).requirements).toEqual([{ section: "Electivas", credits: 27, year: 4, semester: 2 }]);
    const gestion = await s.call("get_plan_subjects", { plan: "S10-Rev23", section: "gestion" });
    expect((gestion.data as { requirements: { section: string }[] }).requirements.map(r => r.section)).toEqual(["Electivas Gestíon"]);
    await s.close();
  });

  test("get_subject_commissions joins quotas", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("get_subject_commissions", { plan: "S10-Rev23", subjectId: "93.41" });
    const data = r.data as { commissions: { name: string; quota?: number; enrolled?: number }[] };
    expect(data.commissions.find(c => c.name === "A")).toMatchObject({ quota: 40, enrolled: 39 });
    await s.close();
  });

  test("generate_schedules returns clash-free combinations, best first", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("generate_schedules", {
      plan: "S10-Rev23", subjects: [{ subjectId: "93.41" }, { subjectId: "72.11" }], limit: 10
    });
    expect(r.isError).toBe(false);
    const data = r.data as { totalFound: number; schedules: { commissions: Record<string, string>; week: Record<string, string[]> }[] };
    // A (Mon 8-11) clashes with S (Mon 9-12): 3 of the 4 combinations remain.
    expect(data.totalFound).toBe(3);
    expect(data.schedules.some(x => x.commissions["93.41"] === "A" && x.commissions["72.11"] === "S")).toBe(false);
    expect(Object.keys(data.schedules[0].week).length).toBeGreaterThan(0);
    await s.close();
  });

  test("generate_schedules reads a saved schedule", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STUDENT });
    const r = await s.call("generate_schedules", { savedScheduleId: "11111111-1111-4111-8111-111111111111" });
    const data = r.data as { plan: string; schedules: { commissions: Record<string, string> }[] };
    expect(data.plan).toBe("S10-Rev23");
    expect(data.schedules.every(x => x.commissions["93.41"] === "B")).toBe(true);
    await s.close();
  });

  test("generate_schedules rejects commission names that match nothing", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("generate_schedules", { plan: "S10-Rev23", subjects: [{ subjectId: "93.41", commissions: ["Z"] }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("93.41 (A, B)");
    await s.close();
  });

  test("generate_schedules reports unknown subjects", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("generate_schedules", { plan: "S10-Rev23", subjects: [{ subjectId: "99.99" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("99.99");
    await s.close();
  });

  test("unknown plans are rejected before any catalog call", async () => {
    const s = await connect({ apiUrl: api.url });
    const before = api.calls.filter(c => c.path === "/v1/subjects").length;
    const r = await s.call("get_plan_subjects", { plan: "made-up-plan" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("made-up-plan");
    expect(r.text).toContain("list_careers");
    expect(api.calls.filter(c => c.path === "/v1/subjects").length).toBe(before);
    await s.close();
  });

  test("list_staff_members says there is no data instead of inventing a year", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("list_staff_members");
    expect(r.isError).toBe(false);
    const data = r.data as { year: number | null; members: unknown[]; note: string };
    expect(data.year).toBeNull();
    expect(data.members).toEqual([]);
    expect(data.note).toContain("integrantes");
    expect(api.calls.some(c => c.path === "/v1/staff-members")).toBe(false);
    await s.close();
  });

  test("search_wiki returns passages with page references", async () => {
    const s = await connect({ apiUrl: api.url, me: { ...ME_STUDENT, capabilities: ["apuntes"] } });
    const r = await s.call("search_wiki", { query: "ecuación de posición", subjectId: "93.41" });
    expect(r.isError).toBe(false);
    const hit = (r.data as { results: Record<string, unknown>[] }).results[0];
    expect(hit).toMatchObject({ slug: "cinematica", section: "Movimiento rectilíneo", resource: "ceitba://wiki/93.41/cinematica" });
    const call = api.calls.findLast(c => c.path === "/v1/wiki/kb/search")!;
    expect(call.query.get("subjectId")).toBe("93.41");
    const none = await s.call("search_wiki", { query: "nada" });
    expect((none.data as { note: string }).note).toContain("No hay");
    await s.close();
  });

  test("report_wiki_page sends the reason and comment", async () => {
    const s = await connect({ apiUrl: api.url, me: { ...ME_STUDENT, capabilities: ["apuntes"] }, scopes: ["read", "report"] });
    const r = await s.call("report_wiki_page", {
      pageId: "22222222-2222-4222-8222-222222222222", reason: "CONTENT_ERROR", comment: "La fórmula está mal"
    });
    expect(r.isError).toBe(false);
    const call = api.calls.findLast(c => c.path.endsWith("/report"))!;
    expect(call.method).toBe("PUT");
    expect(call.path).toBe("/v1/wiki/kb/pages/22222222-2222-4222-8222-222222222222/report");
    expect(call.body).toEqual({ reason: "CONTENT_ERROR", comment: "La fórmula está mal" });
    await s.close();
  });

  test("create_event posts the event for the member's organization, ending 2 h later by default", async () => {
    const member = { ...ME_STUDENT, organizations: [{ slug: "sabf", role: "member" }] };
    const s = await connect({ apiUrl: api.url, me: member, scopes: ["read", "report", "events"], allowWrites: true });
    const date = "2099-05-01";
    const r = await s.call("create_event", {
      organization: "sabf", title: "Charla de bienvenida", date, startTime: "18:30", location: "Aula 101",
      category: "Organizaciones", description: "Traé amigos", signupUrl: "https://forms.example.com/x"
    });
    expect(r.isError).toBe(false);
    expect((r.data as { event: unknown }).event).toEqual({
      id: "33333333-3333-4333-8333-333333333333", title: "Charla de bienvenida", date, time: "18:30-20:30",
      location: "Aula 101", category: "Organizaciones", organization: "sabf"
    });
    const call = api.calls.findLast(c => c.path === "/v1/news/events")!;
    expect(call.method).toBe("POST");
    expect(call.headers.get("x-api-key")).toBe("ceitba_test");
    expect(call.body).toEqual({
      title: "Charla de bienvenida", eventDate: date, startTime: "18:30", endTime: "20:30", location: "Aula 101",
      category: "Organizaciones", organization: "sabf", description: "Traé amigos", onlineUrl: null,
      signupMode: "external", signupUrl: "https://forms.example.com/x"
    });
    await s.close();
  });

  test("create_event refuses other organizations, a missing organization and past dates before calling the API", async () => {
    const member = { ...ME_STUDENT, organizations: [{ slug: "sabf", role: "member" }] };
    const s = await connect({ apiUrl: api.url, me: member, scopes: ["read", "report", "events"], allowWrites: true });
    const before = api.calls.length;
    const base = { title: "T", date: "2099-05-01", startTime: "10:00", location: "L", category: "General" };
    const other = await s.call("create_event", { ...base, organization: "trama" });
    expect(other.isError).toBe(true);
    expect(other.text).toContain("sabf");
    expect((await s.call("create_event", base)).text).toContain("organización");
    const past = await s.call("create_event", { ...base, organization: "sabf", date: "2020-01-01" });
    expect(past.isError).toBe(true);
    expect(past.text).toContain(todayInArgentina());
    expect(api.calls.length).toBe(before);
    await s.close();
  });

  test("staff may create an event without an organization", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: true });
    const r = await s.call("create_event", { title: "Asamblea", date: "2099-05-01", startTime: "12:00", endTime: "14:00", location: "SDF", category: "Campus" });
    expect(r.isError).toBe(false);
    expect(api.calls.findLast(c => c.path === "/v1/news/events")!.body).toMatchObject({ organization: null, endTime: "14:00", signupMode: "none" });
    await s.close();
  });

  test("defaultEndTime adds two hours, capped at 23:59 so it never wraps past midnight", () => {
    expect(defaultEndTime("18:30")).toBe("20:30");
    expect(defaultEndTime("21:59")).toBe("23:59");
    expect(defaultEndTime("23:00")).toBe("23:59");
  });

  test("an end time not after the start is refused before calling the API", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: true });
    const before = api.calls.length;
    const r = await s.call("create_event", { title: "Fiesta", date: "2099-05-01", startTime: "22:00", endTime: "01:00", location: "SDF", category: "Campus" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("01:00");
    expect(api.calls.slice(before).some(c => c.path === "/v1/news/events")).toBe(false);
    await s.close();
  });

  test("API errors become friendly messages", async () => {
    const s = await connect({ apiUrl: api.url, me: { ...ME_STUDENT, capabilities: ["apuntes"] } });
    const r = await s.call("get_subject_wiki", { subjectId: "93.41" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Apuntes");
    await s.close();
  });

  test("the user's API key is sent to the API", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff"] });
    await s.call("staff_list_schedule_corrections", {});
    const call = api.calls.findLast(c => c.path === "/v1/staff/schedule-corrections")!;
    expect(call.headers.get("x-api-key")).toBe("ceitba_test");
    expect(call.query.get("status")).toBe("PENDING");
    await s.close();
  });

  test("per-user rate limit", async () => {
    const s = await connect({ apiUrl: api.url, perMinute: 2 });
    expect((await s.call("list_careers")).isError).toBe(false);
    expect((await s.call("list_careers")).isError).toBe(false);
    const third = await s.call("list_careers");
    expect(third.isError).toBe(true);
    expect(third.text).toContain("Demasiadas");
    await s.close();
  });
});

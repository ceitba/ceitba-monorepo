import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CATALOG, error, ME_STAFF, ME_STUDENT, startFakeApi, type FakeApi } from "./fakeApi";
import { connect } from "./helpers";

let api: FakeApi;

beforeAll(() => {
  api = startFakeApi({
    "GET /v1/careers/plans": () => ({ S: { id: "S", name: "Ingeniería en Informática", plans: ["S10-Rev23"] } }),
    "GET /v1/subjects": req => (req.query.get("plan") === "S10-Rev23" ? CATALOG : {}),
    "GET /v1/commissions": () => [{ id: "c1", subjectCode: "93.41", subjectName: "Física I", commissionName: "A", quota: 40, enrolledStudents: 39 }],
    "GET /v1/me/schedules/:id": () => ({
      id: "11111111-1111-4111-8111-111111111111", name: "Q2", careerId: "S", plan: "S10-Rev23", isPrimary: true,
      createdAt: "", updatedAt: "",
      payload: { version: 1, selectedCourses: [{ subject_id: "93.41", selectedCommissions: ["B"] }, { subject_id: "72.11", selectedCommissions: [] }],
        options: { allowOverlap: false }, blockedTimes: [] }
    }),
    "GET /v1/wiki/subjects/:id/kb": () => error(403, "CAPABILITY_REQUIRED"),
    "GET /v1/staff/schedule-corrections": () => ({ data: [], meta: { total: 0, page: 1, limit: 20 } })
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

  test("every tool description is Spanish first with an English part", async () => {
    const s = await connect({ apiUrl: api.url, me: ME_STAFF, scopes: ["read", "staff", "write"], allowWrites: true });
    const { tools } = await s.client.listTools();
    for (const t of tools) {
      expect(t.description).toContain("EN:");
      expect(t.annotations?.readOnlyHint).toBe(!t.name.includes("review"));
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

  test("generate_schedules reports unknown subjects", async () => {
    const s = await connect({ apiUrl: api.url });
    const r = await s.call("generate_schedules", { plan: "S10-Rev23", subjects: [{ subjectId: "99.99" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("99.99");
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
